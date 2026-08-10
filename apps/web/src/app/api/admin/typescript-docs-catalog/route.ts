import { NextResponse } from "next/server";
import {
  patchPackagePaths,
  upsertManualPackage,
  type DocsPathWrite,
} from "@/lib/server/typescript-docs-catalog-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function denyUnlessDev() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      {
        error:
          "Catalog path editing is only available in local development.",
      },
      { status: 403 },
    );
  }
  return null;
}

function asPathList(value: unknown): DocsPathWrite[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("paths must be an array");
  }
  return value.map((row) => {
    if (!row || typeof row !== "object") {
      throw new Error("each path must be an object with url");
    }
    const url = String((row as { url?: unknown }).url || "").trim();
    if (!url) throw new Error("path.url is required");
    return {
      kind: String((row as { kind?: unknown }).kind || "other"),
      url,
      label:
        typeof (row as { label?: unknown }).label === "string"
          ? (row as { label: string }).label
          : undefined,
      confidence:
        typeof (row as { confidence?: unknown }).confidence === "number"
          ? (row as { confidence: number }).confidence
          : undefined,
    };
  });
}

export async function PATCH(request: Request) {
  const denied = denyUnlessDev();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "patch-paths");

    if (action === "upsert-package") {
      const result = upsertManualPackage({
        packageName: String(body.packageName || body.package || ""),
        docsUrl: String(body.docsUrl || body.docs || ""),
        category:
          typeof body.category === "string" ? body.category : undefined,
        pathUrl: typeof body.pathUrl === "string" ? body.pathUrl : undefined,
        pathKind: typeof body.pathKind === "string" ? body.pathKind : undefined,
        pathLabel:
          typeof body.pathLabel === "string" ? body.pathLabel : undefined,
      });
      return NextResponse.json({
        ok: true,
        package: result.entry.package,
        entry: result.entry,
        catalogCount: result.catalog.count,
        sourcePath: result.sourcePath,
      });
    }

    const packageName = String(body.packageName || body.package || "");
    if (!packageName) {
      return NextResponse.json(
        { error: "packageName is required" },
        { status: 400 },
      );
    }

    const result = patchPackagePaths({
      packageName,
      paths: asPathList(body.paths),
      pathsStatus:
        body.pathsStatus === undefined
          ? undefined
          : body.pathsStatus == null
            ? null
            : String(body.pathsStatus),
      pathsReason:
        body.pathsReason === undefined
          ? undefined
          : body.pathsReason == null
            ? null
            : String(body.pathsReason),
      approve: Boolean(body.approve),
    });

    return NextResponse.json({
      ok: true,
      package: result.entry.package,
      entry: result.entry,
      catalogCount: result.catalog.count,
      sourcePath: result.sourcePath,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update catalog";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
