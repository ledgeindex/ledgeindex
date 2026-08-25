const SCRIPT_SRC =
  "https://storage.googleapis.com/ledgeindex-widget/ledgeindex-widget.bundle.js";

/** Local bundle for `next dev` — run `npm run build` in packages/widget after widget changes. */
const DEV_SCRIPT_SRC = "/widget/ledgeindex-widget.bundle.js";

/** Dev widget — local docs testing (allowlist localhost / LAN IP on this integration). */
const DEV_WIDGET = {
  websiteId: "wgt_vDpBxqtgRUaiwAKk",
  apiBaseUrl: "https://api.ledgeindex.com",
  projectName: "DEV Ledgeindex Widget",
  projectColor: "#6b5a3e",
};

/** Prod widget — ledgeindex.com/docs (allowlist production origins on this integration). */
const PROD_WIDGET = {
  websiteId: "wgt_sq4rdxT-0lORVXcZ",
  apiBaseUrl: "https://api.ledgeindex.com",
  projectName: "Prod Ledgeindex Widget",
  projectColor: "#6b5a3e",
};

function defaultPreset() {
  return process.env.NODE_ENV === "production" ? PROD_WIDGET : DEV_WIDGET;
}

export function docsWidgetEnabled() {
  if (process.env.NEXT_PUBLIC_LEDGEINDEX_DOCS_WIDGET === "0") return false;
  return true;
}

export function readDocsWidgetConfig() {
  const preset = defaultPreset();

  return {
    scriptSrc:
      process.env.NEXT_PUBLIC_LEDGEINDEX_WIDGET_SCRIPT_URL?.trim() ||
      (process.env.NODE_ENV === "production" ? SCRIPT_SRC : DEV_SCRIPT_SRC),
    websiteId:
      process.env.NEXT_PUBLIC_LEDGEINDEX_DOCS_WIDGET_ID?.trim() ||
      preset.websiteId,
    apiBaseUrl:
      process.env.NEXT_PUBLIC_LEDGEINDEX_DOCS_WIDGET_API_BASE?.trim() ||
      preset.apiBaseUrl,
    projectName:
      process.env.NEXT_PUBLIC_LEDGEINDEX_DOCS_WIDGET_NAME?.trim() ||
      preset.projectName,
    projectColor:
      process.env.NEXT_PUBLIC_LEDGEINDEX_DOCS_WIDGET_COLOR?.trim() ||
      preset.projectColor,
  };
}
