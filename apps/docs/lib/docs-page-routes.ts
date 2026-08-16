export type DocsPageMapItem = {
  name?: string;
  route?: string;
  children?: DocsPageMapItem[];
};

export const LEGACY_TOP_LEVEL = new Set(["core", "profile", "server"]);

export function filterDocsSidebarPageMap(
  pageMap: DocsPageMapItem[],
): DocsPageMapItem[] {
  return pageMap.filter((item) => {
    const name = typeof item.name === "string" ? item.name : "";
    const route = typeof item.route === "string" ? item.route : "";
    if (LEGACY_TOP_LEVEL.has(name)) return false;
    if (route === "/core" || route === "/profile" || route === "/server") {
      return false;
    }
    return true;
  });
}

export function collectDocsRoutes(pageMap: DocsPageMapItem[]): string[] {
  const routes: string[] = [];

  const walk = (items: DocsPageMapItem[]) => {
    for (const item of items) {
      const route = typeof item.route === "string" ? item.route : "";
      if (route) {
        const normalized =
          route.endsWith("/") && route.length > 1 ? route.slice(0, -1) : route;
        routes.push(normalized);
      }
      if (item.children?.length) walk(item.children);
    }
  };

  walk(filterDocsSidebarPageMap(pageMap));
  return [...new Set(routes)].sort();
}
