import { parse, type ParserPlugin } from "@babel/parser";
import type { RepoPageKind } from "./indexable-paths.js";

/**
 * Symbol-bounded chunking for JS/TS. A character splitter cuts functions in
 * half and merges unrelated exports; this walks the parse tree so a chunk is a
 * declaration, and stamps the line range so a citation can point at source.
 *
 * Parse-only — no type checker, no program, no tsconfig resolution.
 */

export type CodeSymbolKind =
  | "function"
  | "class"
  | "method"
  | "property"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "namespace"
  | "reexport"
  | "region";

export type CodeChunk = {
  /** Header comment plus source body — this is what gets embedded. */
  text: string;
  /** Source slice without the header. */
  body: string;
  /** 1-based inclusive line range in the original file. */
  startLine: number;
  endLine: number;
  /** Primary symbol, or "" for a merged region. */
  symbolName: string;
  /** Dotted path including the enclosing class or namespace. */
  symbolPath: string;
  symbolKind: CodeSymbolKind;
  exported: boolean;
  /** Every declaration name the chunk covers, for the repo map. */
  symbols: string[];
  /** Set when one oversized declaration had to be split across chunks. */
  partIndex?: number;
  partCount?: number;
  tokenCount: number;
  charCount: number;
};

export type CodeFileAnalysis = {
  chunks: CodeChunk[];
  /** Module specifiers this file imports or re-exports from, deduped. */
  imports: string[];
  /** Top-level exported declarations, for the repo map. */
  exports: Array<{ name: string; kind: CodeSymbolKind; startLine: number }>;
  /** True when the parser gave up and the caller should use a text splitter. */
  parseFailed: boolean;
};

/** Roughly 1024 tokens, matching the docs chunk ceiling. */
export const CODE_CHUNK_MAX_CHARS = 4096;
/**
 * Only genuinely tiny declarations get merged with their neighbours. Anything
 * larger stays its own chunk so a hit points at one named symbol.
 */
export const CODE_CHUNK_MERGE_MAX_CHARS = 500;
/** Lines repeated between parts of a split oversized declaration. */
export const CODE_CHUNK_SPLIT_OVERLAP_LINES = 2;

export type AnalyzeCodeFileInput = {
  /** Posix relative path, used in the chunk header. */
  relativePath: string;
  text: string;
  pageKind?: RepoPageKind;
  maxChars?: number;
};

type RawUnit = {
  startLine: number;
  endLine: number;
  name: string;
  kind: CodeSymbolKind;
  exported: boolean;
  /** Members to recurse into when the unit is over budget. */
  children?: RawUnit[];
  /** Label describing this unit when it becomes the parent of child chunks. */
  contextLabel?: string;
};

type BabelNode = {
  type: string;
  loc?: { start: { line: number }; end: { line: number } } | null;
  leadingComments?: Array<{
    loc?: { start: { line: number }; end: { line: number } } | null;
  }> | null;
  [key: string]: unknown;
};

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function pluginsFor(relativePath: string): ParserPlugin[] {
  const lower = relativePath.toLowerCase();
  // In .ts, `<T>value` is a type assertion; enabling jsx would misparse it.
  if (/\.(ts|mts|cts)$/.test(lower)) return ["typescript", "decorators-legacy"];
  return ["typescript", "jsx", "decorators-legacy"];
}

function nodeName(node: BabelNode | undefined): string {
  if (!node) return "";
  const id = node.id as BabelNode | undefined;
  if (id && typeof id.name === "string") return id.name;
  const key = node.key as BabelNode | undefined;
  if (key) {
    if (typeof key.name === "string") return key.name;
    if (typeof key.value === "string") return key.value;
  }
  const declarations = node.declarations as BabelNode[] | undefined;
  if (Array.isArray(declarations)) {
    const names = declarations
      .map((decl) => {
        const declId = decl.id as BabelNode | undefined;
        return declId && typeof declId.name === "string" ? declId.name : "";
      })
      .filter(Boolean);
    if (names.length) return names.join(", ");
  }
  return "";
}

function kindForNode(node: BabelNode): CodeSymbolKind {
  switch (node.type) {
    case "FunctionDeclaration":
    case "TSDeclareFunction":
      return "function";
    case "ClassDeclaration":
      return "class";
    case "ClassMethod":
    case "ClassPrivateMethod":
    case "TSDeclareMethod":
    case "ObjectMethod":
      return "method";
    case "ClassProperty":
    case "ClassPrivateProperty":
    case "PropertyDefinition":
      return "property";
    case "TSInterfaceDeclaration":
      return "interface";
    case "TSTypeAliasDeclaration":
      return "type";
    case "TSEnumDeclaration":
      return "enum";
    case "VariableDeclaration":
      return "variable";
    case "TSModuleDeclaration":
      return "namespace";
    case "ExportAllDeclaration":
      return "reexport";
    default:
      return "region";
  }
}

/**
 * Start line including an attached doc comment. Comments more than one blank
 * line above the declaration are left out — those belong to the file, not to
 * this symbol.
 */
function startLineWithDoc(node: BabelNode): number {
  const nodeStart = node.loc?.start.line ?? 1;
  const comments = node.leadingComments ?? [];
  let start = nodeStart;

  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    const commentStart = comment?.loc?.start.line;
    const commentEnd = comment?.loc?.end.line;
    if (commentStart === undefined || commentEnd === undefined) break;
    if (commentEnd < start - 2) break;
    start = commentStart;
  }

  return start;
}

function moduleSpecifier(node: BabelNode): string {
  const source = node.source as BabelNode | undefined;
  return source && typeof source.value === "string" ? source.value : "";
}

function classMemberUnits(node: BabelNode, className: string): RawUnit[] {
  const body = node.body as BabelNode | undefined;
  const members = (body?.body as BabelNode[] | undefined) ?? [];
  return members
    .filter((member) => member.loc)
    .map((member) => {
      const kind = kindForNode(member);
      const rawName = nodeName(member);
      const isConstructor = member.kind === "constructor";
      const name = isConstructor ? "constructor" : rawName;
      return {
        startLine: startLineWithDoc(member),
        endLine: member.loc?.end.line ?? member.loc?.start.line ?? 1,
        name: name || `${className} member`,
        kind,
        exported: false,
      } satisfies RawUnit;
    });
}

function namespaceMemberUnits(node: BabelNode): RawUnit[] {
  const body = node.body as BabelNode | undefined;
  const statements = (body?.body as BabelNode[] | undefined) ?? [];
  return statements.filter((statement) => statement.loc).map(topLevelUnit);
}

function topLevelUnit(node: BabelNode): RawUnit {
  let target = node;
  let exported = false;

  if (
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportDefaultDeclaration"
  ) {
    exported = true;
    const declaration = node.declaration as BabelNode | undefined;
    if (declaration) target = declaration;
  }

  const kind = kindForNode(target);
  const name = nodeName(target);
  const startLine = startLineWithDoc(node);
  const endLine = node.loc?.end.line ?? startLine;

  const unit: RawUnit = {
    startLine,
    endLine,
    name:
      name ||
      (node.type === "ExportNamedDeclaration" ? "re-exports" : ""),
    kind:
      name || kind !== "region"
        ? kind
        : node.type === "ExportNamedDeclaration"
          ? "reexport"
          : "region",
    exported,
  };

  if (target.type === "ClassDeclaration") {
    unit.children = classMemberUnits(target, name);
    unit.contextLabel = `class ${name || "(anonymous)"}`;
  } else if (target.type === "TSModuleDeclaration") {
    unit.children = namespaceMemberUnits(target);
    unit.contextLabel = `namespace ${name || "(anonymous)"}`;
  }

  return unit;
}

function sliceLines(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine - 1, endLine).join("\n").replace(/\s+$/, "");
}

/** A merged region can cover dozens of tiny declarations; naming them all in
 * the header costs more than it explains. */
const HEADER_SYMBOL_LIMIT = 8;

function formatSymbolList(symbols: string[]): string {
  if (symbols.length <= HEADER_SYMBOL_LIMIT) return symbols.join(", ");
  const shown = symbols.slice(0, HEADER_SYMBOL_LIMIT).join(", ");
  return `${shown}, +${symbols.length - HEADER_SYMBOL_LIMIT} more`;
}

function buildHeader(input: {
  relativePath: string;
  startLine: number;
  endLine: number;
  symbolPath: string;
  symbolKind: CodeSymbolKind;
  exported: boolean;
  contextLabel?: string;
  partIndex?: number;
  partCount?: number;
}): string {
  const location = `${input.relativePath}:${input.startLine}-${input.endLine}`;
  const descriptor = [
    input.contextLabel ? `${input.contextLabel} \u2192 ` : "",
    input.symbolPath || "(file scope)",
  ].join("");
  const tags = [
    input.symbolKind,
    input.exported ? "exported" : null,
    input.partCount && input.partCount > 1
      ? `part ${input.partIndex} of ${input.partCount}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `// ${location}\n// ${descriptor} \u2014 ${tags}`;
}

type PackContext = {
  relativePath: string;
  lines: string[];
  /** Cumulative char count through the end of each line, 1-based. */
  lineEnds: number[];
  maxChars: number;
  /** Enclosing class or namespace, when packing members. */
  contextLabel?: string;
  parentPath?: string;
};

function buildLineEnds(lines: string[]): number[] {
  const ends = new Array<number>(lines.length + 1);
  ends[0] = 0;
  for (let index = 0; index < lines.length; index += 1) {
    ends[index + 1] = ends[index]! + lines[index]!.length + 1;
  }
  return ends;
}

/**
 * Chars covered by a line range, gaps included. Summing individual units
 * undercounts, because blank lines and unattached comments between them still
 * end up in the merged slice.
 */
function spanChars(ctx: PackContext, startLine: number, endLine: number): number {
  const start = Math.max(0, Math.min(startLine - 1, ctx.lines.length));
  const end = Math.max(0, Math.min(endLine, ctx.lines.length));
  return Math.max(0, ctx.lineEnds[end]! - ctx.lineEnds[start]!);
}

function lineChars(ctx: PackContext, line: number): number {
  return spanChars(ctx, line, line);
}

function makeChunk(
  ctx: PackContext,
  input: {
    startLine: number;
    endLine: number;
    symbols: string[];
    symbolKind: CodeSymbolKind;
    exported: boolean;
    partIndex?: number;
    partCount?: number;
    /** Used when one very long line had to be sliced by character. */
    bodyOverride?: string;
  },
): CodeChunk {
  const body =
    input.bodyOverride ?? sliceLines(ctx.lines, input.startLine, input.endLine);
  const primary = input.symbols[0] ?? "";
  const symbolPath = [ctx.parentPath, primary].filter(Boolean).join(".");
  const header = buildHeader({
    relativePath: ctx.relativePath,
    startLine: input.startLine,
    endLine: input.endLine,
    symbolPath:
      input.symbols.length > 1
        ? formatSymbolList(input.symbols)
        : symbolPath,
    symbolKind: input.symbolKind,
    exported: input.exported,
    contextLabel: ctx.contextLabel,
    partIndex: input.partIndex,
    partCount: input.partCount,
  });
  const text = `${header}\n\n${body}`;

  return {
    text,
    body,
    startLine: input.startLine,
    endLine: input.endLine,
    symbolName: primary,
    symbolPath: symbolPath || primary,
    symbolKind: input.symbolKind,
    exported: input.exported,
    symbols: input.symbols.filter(Boolean),
    partIndex: input.partIndex,
    partCount: input.partCount,
    tokenCount: estimateTokenCount(text),
    charCount: text.length,
  };
}

/**
 * Split one oversized declaration into line windows with a small overlap. A
 * single line longer than the budget (generated or minified code) is emitted
 * alone and sliced by character, which keeps its reported line range exact.
 */
function splitOversized(ctx: PackContext, unit: RawUnit): CodeChunk[] {
  const windows: Array<{ startLine: number; endLine: number; hard: boolean }> =
    [];
  let cursor = unit.startLine;

  while (cursor <= unit.endLine) {
    if (lineChars(ctx, cursor) > ctx.maxChars) {
      windows.push({ startLine: cursor, endLine: cursor, hard: true });
      cursor += 1;
      continue;
    }

    let end = cursor;
    let size = 0;
    while (end <= unit.endLine) {
      const lineLength = lineChars(ctx, end);
      if (size + lineLength > ctx.maxChars && end > cursor) break;
      if (lineLength > ctx.maxChars) break;
      size += lineLength;
      end += 1;
    }
    const endLine = Math.max(cursor, Math.min(end - 1, unit.endLine));
    windows.push({ startLine: cursor, endLine, hard: false });
    if (endLine >= unit.endLine) break;
    cursor = Math.max(cursor + 1, endLine - CODE_CHUNK_SPLIT_OVERLAP_LINES + 1);
  }

  const pieces: Array<{
    startLine: number;
    endLine: number;
    bodyOverride?: string;
  }> = [];

  for (const window of windows) {
    if (!window.hard) {
      pieces.push({ startLine: window.startLine, endLine: window.endLine });
      continue;
    }
    const line = ctx.lines[window.startLine - 1] ?? "";
    for (let offset = 0; offset < line.length; offset += ctx.maxChars) {
      pieces.push({
        startLine: window.startLine,
        endLine: window.endLine,
        bodyOverride: line.slice(offset, offset + ctx.maxChars),
      });
    }
  }

  return pieces.map((piece, index) =>
    makeChunk(ctx, {
      startLine: piece.startLine,
      endLine: piece.endLine,
      symbols: [unit.name],
      symbolKind: unit.kind,
      exported: unit.exported,
      partIndex: index + 1,
      partCount: pieces.length,
      bodyOverride: piece.bodyOverride,
    }),
  );
}

/**
 * Turn units into chunks: merge small neighbours, recurse into oversized
 * classes and namespaces, window-split anything still too large.
 */
function packUnits(ctx: PackContext, units: RawUnit[]): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  let run: RawUnit[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const first = run[0]!;
    const last = run.at(-1)!;
    chunks.push(
      makeChunk(ctx, {
        startLine: first.startLine,
        endLine: last.endLine,
        symbols: run.map((unit) => unit.name).filter(Boolean),
        symbolKind: run.length === 1 ? first.kind : "region",
        exported: run.some((unit) => unit.exported),
      }),
    );
    run = [];
  };

  for (const unit of units) {
    const size = spanChars(ctx, unit.startLine, unit.endLine);

    if (size > ctx.maxChars) {
      flushRun();
      if (unit.children?.length) {
        const declarationEnd = Math.min(
          unit.children[0]!.startLine - 1,
          unit.endLine,
        );
        if (declarationEnd >= unit.startLine) {
          chunks.push(
            makeChunk(ctx, {
              startLine: unit.startLine,
              endLine: declarationEnd,
              symbols: [unit.name],
              symbolKind: unit.kind,
              exported: unit.exported,
            }),
          );
        }
        chunks.push(
          ...packUnits(
            {
              ...ctx,
              contextLabel: unit.contextLabel,
              parentPath: [ctx.parentPath, unit.name].filter(Boolean).join("."),
            },
            unit.children,
          ),
        );
      } else {
        chunks.push(...splitOversized(ctx, unit));
      }
      continue;
    }

    const mergeable = size <= CODE_CHUNK_MERGE_MAX_CHARS;
    if (!mergeable) {
      flushRun();
      chunks.push(
        makeChunk(ctx, {
          startLine: unit.startLine,
          endLine: unit.endLine,
          symbols: [unit.name],
          symbolKind: unit.kind,
          exported: unit.exported,
        }),
      );
      continue;
    }

    const runStart = run[0]?.startLine;
    if (
      runStart !== undefined &&
      spanChars(ctx, runStart, unit.endLine) > ctx.maxChars
    ) {
      flushRun();
    }
    run.push(unit);
  }

  flushRun();
  return chunks;
}

export function analyzeCodeFile(
  input: AnalyzeCodeFileInput,
): CodeFileAnalysis {
  const text = input.text;
  const maxChars = input.maxChars ?? CODE_CHUNK_MAX_CHARS;
  const empty: CodeFileAnalysis = {
    chunks: [],
    imports: [],
    exports: [],
    parseFailed: false,
  };
  if (!text.trim()) return empty;

  let program: BabelNode[];
  try {
    const ast = parse(text, {
      sourceType: "unambiguous",
      plugins: pluginsFor(input.relativePath),
      errorRecovery: true,
      attachComment: true,
      ranges: false,
    });
    program = (ast.program.body as unknown as BabelNode[]) ?? [];
  } catch {
    return { ...empty, parseFailed: true };
  }

  const lines = text.split("\n");
  const imports = new Set<string>();
  const units: RawUnit[] = [];
  const exports: CodeFileAnalysis["exports"] = [];

  for (const node of program) {
    if (!node.loc) continue;

    if (node.type === "ImportDeclaration") {
      const specifier = moduleSpecifier(node);
      if (specifier) imports.add(specifier);
      continue;
    }
    if (
      node.type === "ExportAllDeclaration" ||
      (node.type === "ExportNamedDeclaration" && !node.declaration)
    ) {
      const specifier = moduleSpecifier(node);
      if (specifier) imports.add(specifier);
    }
    if (node.type === "TSImportEqualsDeclaration") continue;

    const unit = topLevelUnit(node);
    units.push(unit);
    if (unit.exported && unit.name) {
      exports.push({
        name: unit.name,
        kind: unit.kind,
        startLine: unit.startLine,
      });
    }
  }

  const ctx: PackContext = {
    relativePath: input.relativePath,
    lines,
    lineEnds: buildLineEnds(lines),
    maxChars,
  };

  // Barrel or import-only file: index it whole so the module surface is findable.
  if (units.length === 0) {
    return {
      chunks: splitOversized(ctx, {
        startLine: 1,
        endLine: lines.length,
        name: "",
        kind: "reexport",
        exported: true,
      }),
      imports: [...imports],
      exports,
      parseFailed: false,
    };
  }

  const chunks = packUnits(ctx, units);

  return {
    chunks: chunks.filter((chunk) => chunk.body.trim().length > 0),
    imports: [...imports],
    exports,
    parseFailed: false,
  };
}
