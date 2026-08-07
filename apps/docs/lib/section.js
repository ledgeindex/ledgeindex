export function getDocsSection(pathname) {
  if (!pathname) return "docs";
  if (pathname === "/reference" || pathname.startsWith("/reference/")) {
    return "reference";
  }
  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return "docs";
  }
  return "home";
}
