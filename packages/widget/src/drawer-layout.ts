const STYLE_ID = "ledgeindex-widget-drawer-layout";

export function syncDrawerLayout(open: boolean, width: string): void {
  if (typeof document === "undefined") return;

  if (!open) {
    document.documentElement.classList.remove("li-widget-drawer-open");
    document.getElementById(STYLE_ID)?.remove();
    return;
  }

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = `
    html.li-widget-drawer-open {
      --li-drawer-width: ${width};
    }
    html.li-widget-drawer-open body {
      margin-right: var(--li-drawer-width) !important;
      transition: margin-right 0.25s ease;
    }
  `;
  document.documentElement.classList.add("li-widget-drawer-open");
}

export function clearDrawerLayout(): void {
  syncDrawerLayout(false, "0px");
}
