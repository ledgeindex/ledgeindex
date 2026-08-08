export type LedgeIndexClientOptions = {
  apiBaseUrl: string;
  getAuthHeaders?: () => Promise<Record<string, string>>;
};

export function createLedgeIndexClient(options: LedgeIndexClientOptions) {
  const base = options.apiBaseUrl.replace(/\/$/, "");

  async function headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    const auth = (await options.getAuthHeaders?.()) ?? {};
    return {
      "Content-Type": "application/json",
      ...auth,
      ...extra,
    };
  }

  return {
    apiBaseUrl: base,
    async getHealth(): Promise<unknown> {
      const res = await fetch(`${base}/health`, { headers: await headers() });
      if (!res.ok) throw new Error(`health ${res.status}`);
      return res.json();
    },
    async get(path: string): Promise<Response> {
      return fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
        headers: await headers(),
      });
    },
    async post(path: string, body: unknown): Promise<Response> {
      return fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify(body),
      });
    },
  };
}
