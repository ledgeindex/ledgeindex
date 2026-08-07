// @ts-nocheck
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { tryFetchNativeMarkdown, isMarkdownResponse } from "./markdown-alternate.js";
import {
  extractFirstMarkdownHeading,
  extractHtmlHeadingTitle,
  extractMetaTitle,
  resolvePageTitle,
} from "./page-title.js";

export type ParsePageResult = {
  url: string;
  title: string;
  markdown: string;
};

function createTurndown() {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  // Prism / Docusaurus render each line as `.token-line` spans — default turndown
  // flattens them into one line and destroys code formatting.
  service.addRule("prismPreCode", {
    filter: "pre",
    replacement: (_content: string, node: unknown) => {
      const element = node as HTMLElement;
      const code = (element.textContent ?? "").replace(/\n+$/, "");
      const lang = extractCodeLanguageFromClass(
        element.getAttribute("class") ??
          element.querySelector("code")?.getAttribute("class") ??
          "",
      );
      const trimmed = code.replace(/\n+$/, "");
      return `\n\n\`\`\`${lang}\n${trimmed}\n\`\`\`\n\n`;
    },
  });

  return service;
}

function extractCodeLanguageFromClass(className: string): string {
  const match = className.match(/language-([\w+#.-]+)/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function extractPreElementCode(
  $: cheerio.CheerioAPI,
  $pre: Cheerio<unknown>,
): string {
  const $lines = $pre.find(".token-line, span.line");
  if ($lines.length > 0) {
    return $lines
      .map((_, line) => $(line).text())
      .get()
      .join("\n");
  }

  // Many highlighters use <br> instead of per-line spans for some themes/languages.
  const $clone = $pre.clone();
  $clone.find("br").replaceWith("\n");
  return $clone.text();
}

function extractCodeLanguage($pre: Cheerio<unknown>): string {
  const classes = [
    $pre.attr("class"),
    $pre.find("code").first().attr("class"),
    $pre.closest('[class*="language-"]').attr("class"),
  ]
    .filter(Boolean)
    .join(" ");
  return extractCodeLanguageFromClass(classes);
}

/**
 * Multi-language code tabs often render every sample in the DOM (inactive panels
 * hidden via CSS/ARIA). Keep one panel per group — prefer active, else first visible.
 */
function resolveTabbedCodeSamples($: cheerio.CheerioAPI): void {
  const parents = new Set<unknown>();

  $("[role='tabpanel']").each((_, panel) => {
    const parent = $(panel).parent().get(0);
    if (!parent) return;
    if ($(parent).children("[role='tabpanel']").length <= 1) return;
    parents.add(parent);
  });

  for (const parent of parents) {
    const $parent = $(parent);
    const panels = $parent.children("[role='tabpanel']");

    let keepPanel = panels
      .filter((_, panel) => $(panel).attr("data-state") === "active")
      .first();
    if (!keepPanel.length) {
      keepPanel = panels
        .filter((_, panel) => {
          const $panel = $(panel);
          return (
            $panel.attr("hidden") === undefined &&
            $panel.attr("aria-hidden") !== "true"
          );
        })
        .first();
    }
    if (!keepPanel.length) keepPanel = panels.first();

    panels.each((_, panel) => {
      if (panel !== keepPanel.get(0)) $(panel).remove();
    });

    $parent.find("[role='tab']").remove();
    $parent.children("[role='tablist']").remove();
    $parent.find('[data-component-part*="tab-bar"]').remove();
  }
}

/**
 * Normalize Prism/Docusaurus code blocks before Turndown so each `.token-line`
 * becomes a real newline in the stored markdown.
 */
export function normalizeCodeBlocksInHtml(html: string): string {
  const $ = cheerio.load(`<div data-root="true">${html}</div>`);

  $("pre").each((_, el) => {
    const $pre = $(el);
    const code = extractPreElementCode($, $pre);

    const lang = extractCodeLanguage($pre);
    $pre.empty();
    $pre.text(code);
    if (lang) {
      $pre.attr("class", `language-${lang}`);
    }
  });

  return $("[data-root]").html() ?? html;
}

/**
 * Doc-site chrome: duplicate responsive columns, tabbed code samples, copy-link UI.
 */
export function normalizeDocsChromeInHtml(html: string): string {
  const $ = cheerio.load(`<div data-root="true">${html}</div>`);

  // Responsive layouts often keep a duplicate sticky column in the DOM (hidden on small viewports).
  $("[data-root] div")
    .filter((_, el) => {
      const cls = $(el).attr("class") ?? "";
      return (
        cls.includes("hidden") &&
        cls.includes("xl:flex") &&
        cls.includes("self-start")
      );
    })
    .remove();

  resolveTabbedCodeSamples($);

  $("button, a").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (/copy (page|link)/i.test(text)) {
      $(el).remove();
    }
  });

  return $("[data-root]").html() ?? html;
}

function appendHtmlFragment(target: string, fragment: string): string {
  if (!fragment.trim()) return target;
  if (!target.trim()) return fragment;
  return `${target}\n${fragment}`;
}

/**
 * Docusaurus adds per-heading hash links ("Direct link to …") for copy-link UX.
 * Turndown turns those into `[Direct link to Title](#id)` because it uses the
 * anchor's visible text — not the heading title. We remove that chrome and, when
 * the heading has an id, emit a real section URL: `[Title](page#id)`.
 */
export function normalizeHeadingAnchorsInHtml(
  html: string,
  pageUrl: string,
): string {
  const $ = cheerio.load(`<div data-root="true">${html}</div>`);

  const pageBase = pageUrl.split("#")[0] ?? pageUrl;

  $("h1, h2, h3, h4, h5, h6").each((_, heading) => {
    const $heading = $(heading);
    $heading.find("a.hash-link").remove();
    $heading.find('a[aria-label^="Direct link"]').remove();
    $heading.find('a[title^="Direct link"]').remove();
    $heading.find('a[href^="#"]').remove();

    const id = $heading.attr("id")?.trim();
    const title = $heading.text().replace(/\s+/g, " ").trim();
    if (!title) return;

    if (id && pageBase) {
      const sectionUrl = `${pageBase}#${id}`;
      $heading.empty();
      $heading.append($("<a></a>").attr("href", sectionUrl).text(title));
      return;
    }

    $heading.text(title);
  });

  return $("[data-root]").html() ?? html;
}

/** Safety net after Turndown for any anchor-link text that slipped through. */
export function cleanDocusaurusAnchorMarkdown(markdown: string): string {
  return markdown
    .replace(
      /^(#{1,6}\s+)([^\[\n]+?)\[\s*(?:Direct link to[^\]]*)?\]\([^)]*\)/gim,
      "$1$2",
    )
    .replace(/^\s*Direct link to .+\s*$/gim, "")
    .replace(/Copy page/gi, "")
    .replace(/Copy link/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Marketing sites (Framer, etc.) embed logos as `<img src="data:image/svg+xml,...">`
 * and inline `<svg>`. They are useless for text indexing and can be 50k+ chars per page.
 */
export function stripEmbeddedGraphicsFromHtml(html: string): string {
  const $ = cheerio.load(`<div data-root="true">${html}</div>`);

  $("img[src^='data:'], img[src^='blob:']").remove();
  $("svg").remove();
  $("picture").each((_, el) => {
    const $pic = $(el);
    if ($pic.find("img[src^='data:'], img[src^='blob:'], source[src^='data:']").length) {
      $pic.remove();
    }
  });

  return $("[data-root]").html() ?? html;
}

/** Catches any data/blob image markdown Turndown still emitted. */
export function stripEmbeddedGraphicsMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\(<(?:data|blob):[^>]+>\)/g, "")
    .replace(/!\[[^\]]*\]\((?:data|blob):[^)]+\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchPageHtml(
  url: string,
  userAgent: string,
): Promise<{ html: string; status: number }> {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  const html = await response.text();
  return { html, status: response.status };
}

export function extractContentFromHtml(
  html: string,
  url: string,
  contentSelectors: string[],
  excludeSelectors: string[],
): ParsePageResult {
  const $ = cheerio.load(html);

  const htmlTitle = $("title").first().text().trim();
  const metaTitle = extractMetaTitle($);
  const htmlHeading = extractHtmlHeadingTitle($);

  for (const selector of excludeSelectors) {
    if (!selector.trim()) continue;
    try {
      $(selector).remove();
    } catch {
      // invalid selector — skip
    }
  }

  let readabilityTitle = "";
  let contentHtml = "";

  if (contentSelectors.length > 0) {
    for (const selector of contentSelectors) {
      if (!selector.trim()) continue;
      try {
        $(selector).each((_, element) => {
          contentHtml = appendHtmlFragment(contentHtml, $.html(element));
        });
      } catch {
        // invalid selector — skip
      }
    }
  }

  if (!contentHtml.trim()) {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article?.content) {
      contentHtml = article.content;
      if (article.title) readabilityTitle = article.title;
    } else {
      contentHtml = $("body").html() ?? "";
    }
  }

  contentHtml = normalizeDocsChromeInHtml(contentHtml);
  contentHtml = normalizeCodeBlocksInHtml(contentHtml);
  contentHtml = normalizeHeadingAnchorsInHtml(contentHtml, url);
  contentHtml = stripEmbeddedGraphicsFromHtml(contentHtml);

  const turndown = createTurndown();
  const markdown = stripEmbeddedGraphicsMarkdown(
    cleanDocusaurusAnchorMarkdown(turndown.turndown(contentHtml).trim()),
  );

  const resolvedTitle = resolvePageTitle({
    url,
    htmlTitle,
    metaTitle,
    readabilityTitle,
    htmlHeading,
    markdownHeading: extractFirstMarkdownHeading(markdown),
  });

  return {
    url,
    title: resolvedTitle,
    markdown,
  };
}

export async function parsePage(
  url: string,
  contentSelectors: string[],
  excludeSelectors: string[],
  userAgent: string,
): Promise<ParsePageResult> {
  const nativeMarkdown = await tryFetchNativeMarkdown(url, userAgent);
  if (nativeMarkdown) {
    return {
      ...nativeMarkdown,
      title: resolvePageTitle({
        url,
        markdownHeading: extractFirstMarkdownHeading(nativeMarkdown.markdown),
      }),
    };
  }

  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (isMarkdownResponse(contentType, body)) {
    const markdown = body.trim();
    return {
      url,
      title: resolvePageTitle({
        url,
        markdownHeading: extractFirstMarkdownHeading(markdown),
      }),
      markdown,
    };
  }

  return extractContentFromHtml(body, url, contentSelectors, excludeSelectors);
}
