import { mountWidget } from "./chat-widget";
import { readConfigFromScript } from "./api";

declare global {
  interface Window {
    LedgeIndexWidget?: {
      mount: typeof mountWidget;
    };
  }
}

const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>(
    "script[data-website-id][src*='ledgeindex-widget']",
  );

if (script) {
  const start = () => mountWidget(readConfigFromScript(script));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

window.LedgeIndexWidget = { mount: mountWidget };

export { mountWidget };
