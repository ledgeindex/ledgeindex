export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 20) return apiKey;
  const visibleStart = apiKey.slice(0, 12);
  const visibleEnd = apiKey.slice(-4);
  const hiddenLength = Math.max(
    apiKey.length - visibleStart.length - visibleEnd.length,
    8,
  );
  return `${visibleStart}${"•".repeat(hiddenLength)}${visibleEnd}`;
}
