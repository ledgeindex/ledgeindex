import { mountWidget } from "./chat-widget";
import { readConfigFromScript, type WidgetHandle } from "./api";

declare global {
  interface Window {
    LedgeIndexWidget?: {
      mount: typeof mountWidget;
      open?: () => void;
      close?: () => void;
      toggle?: () => void;
      unmount?: () => void;
    };
  }
}

const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>(
    "script[data-website-id][src*='ledgeindex-widget']",
  );

function exposeHandle(handle: WidgetHandle): void {
  window.LedgeIndexWidget = {
    mount: mountWidget,
    open: () => handle.open(),
    close: () => handle.close(),
    toggle: () => handle.toggle(),
    unmount: () => handle.unmount(),
  };
}

if (script) {
  const start = () => exposeHandle(mountWidget(readConfigFromScript(script)));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
} else {
  window.LedgeIndexWidget = { mount: mountWidget };
}

export { mountWidget };
