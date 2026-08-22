import {
  authenticatedFetch,
  getLedgeIndexApiBaseUrl,
  KnowledgeIndexApiError,
  listSources,
  resolveRemoteApiBaseUrl,
} from "@/lib/ledgeindex-api";

const DEFAULT_CLOUD_API = "https://api.ledgeindex.com";

/** Widget registry + chat for embeds always use the hosted cloud API. */
export function resolveWidgetCloudApiBaseUrl(): string {
  const remote = resolveRemoteApiBaseUrl();
  if (remote) return remote;
  const active = getLedgeIndexApiBaseUrl().replace(/\/$/, "");
  if (active && !/localhost|127\.0\.0\.1/i.test(active)) return active;
  return DEFAULT_CLOUD_API;
}

export type WidgetBrand = {
  projectName: string;
  projectColor: string;
  projectLogo: string | null;
};

export type WidgetIntegrationSummary = {
  websiteId: string;
  name: string;
  brand: WidgetBrand;
  status: "active" | "disabled";
  sourceIds: string[];
  allowedOrigins: string[];
  createdAt: string;
  updatedAt: string;
};

/** Always hit the Fastify API — never the Next.js origin (e.g. :3004). */
function widgetApiUrl(path: string): string {
  const base = resolveWidgetCloudApiBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function listWidgetIntegrations(): Promise<WidgetIntegrationSummary[]> {
  const res = await authenticatedFetch(widgetApiUrl("/api/widget/integrations"));
  const json = (await res.json()) as {
    success?: boolean;
    data?: WidgetIntegrationSummary[];
    error?: string;
  };
  if (!res.ok) {
    throw new KnowledgeIndexApiError(
      json.error || "Failed to list widgets",
      res.status,
    );
  }
  return json.data ?? [];
}

export async function createWidgetIntegration(input: {
  name: string;
  sourceIds: string[];
  allowedOrigins: string[];
  brand?: Partial<WidgetBrand>;
}): Promise<WidgetIntegrationSummary> {
  const res = await authenticatedFetch(widgetApiUrl("/api/widget/integrations"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as {
    success?: boolean;
    data?: WidgetIntegrationSummary;
    error?: unknown;
  };
  if (!res.ok || !json.data) {
    throw new KnowledgeIndexApiError(
      typeof json.error === "string" ? json.error : "Failed to create widget",
      res.status,
    );
  }
  return json.data;
}

export async function updateWidgetIntegration(
  websiteId: string,
  input: {
    name?: string;
    sourceIds?: string[];
    allowedOrigins?: string[];
    brand?: Partial<WidgetBrand>;
    status?: "active" | "disabled";
  },
): Promise<WidgetIntegrationSummary> {
  const res = await authenticatedFetch(
    widgetApiUrl(`/api/widget/integrations/${encodeURIComponent(websiteId)}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const json = (await res.json()) as {
    success?: boolean;
    data?: WidgetIntegrationSummary;
    error?: unknown;
  };
  if (!res.ok || !json.data) {
    throw new KnowledgeIndexApiError(
      typeof json.error === "string" ? json.error : "Failed to update widget",
      res.status,
    );
  }
  return json.data;
}

export async function deleteWidgetIntegration(websiteId: string): Promise<void> {
  const res = await authenticatedFetch(
    widgetApiUrl(`/api/widget/integrations/${encodeURIComponent(websiteId)}`),
    { method: "DELETE" },
  );
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new KnowledgeIndexApiError(
      json.error || "Failed to delete widget",
      res.status,
    );
  }
}

export function widgetEmbedSnippet(websiteId: string, brand: WidgetBrand): string {
  const api = resolveWidgetCloudApiBaseUrl();
  const scriptSrc =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_LEDGEINDEX_WIDGET_SCRIPT_URL?.trim()
      ? process.env.NEXT_PUBLIC_LEDGEINDEX_WIDGET_SCRIPT_URL.trim()
      : "https://storage.googleapis.com/ledgeindex-widget/ledgeindex-widget.bundle.js";

  const attrs = [
    `src="${scriptSrc}"`,
    `data-website-id="${websiteId}"`,
    `data-api-base-url="${api}"`,
    `data-project-name="${escapeAttr(brand.projectName)}"`,
    `data-project-color="${escapeAttr(brand.projectColor)}"`,
  ];
  if (brand.projectLogo) {
    attrs.push(`data-project-logo="${escapeAttr(brand.projectLogo)}"`);
  }

  return `<script\n  async\n  ${attrs.join("\n  ")}\n></script>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export { listSources };
