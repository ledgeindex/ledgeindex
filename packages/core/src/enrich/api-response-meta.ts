import { z } from "zod";

export const apiResponseContentTypeSchema = z.enum([
  "json",
  "xml",
  "text",
  "html",
  "other",
]);

export type ApiResponseContentType = z.infer<typeof apiResponseContentTypeSchema>;

export const apiResponseMetaSchema = z.object({
  httpStatus: z.number().int().min(100).max(599).nullable().optional(),
  statusText: z.string().min(1).nullable().optional(),
  /** Machine-readable code from the response body (e.g. error.code: FORBIDDEN). */
  errorCode: z.string().min(1).nullable().optional(),
  contentType: apiResponseContentTypeSchema.nullable().optional(),
});

export type ApiResponseMeta = z.infer<typeof apiResponseMetaSchema>;

const llmApiResponseMetaSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  const parsed = apiResponseMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}, apiResponseMetaSchema.nullable().optional());

export const llmExtractedApiResponseFieldSchema = llmApiResponseMetaSchema;

export function inferHttpStatusFromTitle(title: string): {
  httpStatus: number;
  statusText: string;
} | null {
  const match = /^(\d{3})\s+(.+)$/.exec(title.trim());
  if (!match) return null;
  const code = Number(match[1]);
  const statusText = match[2]!.trim();
  if (!Number.isFinite(code) || code < 100 || code > 599 || !statusText) {
    return null;
  }
  return { httpStatus: code, statusText };
}

export function inferErrorCodeFromResponseBody(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const code = (error as Record<string, unknown>).code;
      if (typeof code === "string" && code.trim()) return code.trim();
    }
    if (typeof record.code === "string" && record.code.trim()) {
      return record.code.trim();
    }
  } catch {
    return null;
  }
  return null;
}

export function inferContentTypeFromBody(body: string): ApiResponseContentType {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<")) return "xml";
  return "text";
}

export function normalizeApiResponseMeta(input: {
  kind: string;
  title: string;
  body: string;
  fromLlm?: ApiResponseMeta | null;
}): ApiResponseMeta | null {
  if (input.kind !== "api_response" && !input.fromLlm) return null;

  const fromTitle = inferHttpStatusFromTitle(input.title);
  const errorCode =
    input.fromLlm?.errorCode?.trim() ||
    inferErrorCodeFromResponseBody(input.body) ||
    null;
  const contentType =
    input.fromLlm?.contentType ?? inferContentTypeFromBody(input.body);

  const httpStatus =
    input.fromLlm?.httpStatus ?? fromTitle?.httpStatus ?? null;
  const statusText =
    input.fromLlm?.statusText?.trim() ||
    fromTitle?.statusText ||
    null;

  if (
    httpStatus == null &&
    !errorCode &&
    !statusText &&
    input.kind !== "api_response"
  ) {
    return null;
  }

  return {
    httpStatus: httpStatus ?? null,
    statusText: statusText ?? null,
    errorCode,
    contentType,
  };
}

export function formatApiResponseMetaLine(meta: ApiResponseMeta): string {
  const parts: string[] = [];
  if (meta.httpStatus != null) {
    parts.push(
      meta.statusText
        ? `HTTP ${meta.httpStatus} ${meta.statusText}`
        : `HTTP ${meta.httpStatus}`,
    );
  } else if (meta.statusText) {
    parts.push(meta.statusText);
  }
  if (meta.errorCode) parts.push(`Error code: ${meta.errorCode}`);
  if (meta.contentType) parts.push(`Content-Type: ${meta.contentType}`);
  return parts.join(" | ");
}

export function apiResponseMetaFromChunkMetadata(
  metadata: Record<string, unknown>,
): ApiResponseMeta | null {
  const httpStatusRaw = metadata.apiHttpStatus;
  const errorCode =
    typeof metadata.apiErrorCode === "string"
      ? metadata.apiErrorCode.trim() || null
      : null;
  const statusText =
    typeof metadata.apiStatusText === "string"
      ? metadata.apiStatusText.trim() || null
      : null;
  const contentTypeRaw = metadata.apiContentType;

  const httpStatus =
    typeof httpStatusRaw === "number" && Number.isFinite(httpStatusRaw)
      ? httpStatusRaw
      : null;

  const contentTypeParsed = apiResponseContentTypeSchema.safeParse(
    contentTypeRaw,
  );
  const contentType = contentTypeParsed.success ? contentTypeParsed.data : null;

  if (httpStatus == null && !errorCode && !statusText && !contentType) {
    return null;
  }

  return {
    httpStatus,
    statusText,
    errorCode,
    contentType,
  };
}

export function apiResponseMetaToChunkMetadata(
  meta: ApiResponseMeta | null | undefined,
): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  if (meta.httpStatus != null) out.apiHttpStatus = meta.httpStatus;
  if (meta.statusText) out.apiStatusText = meta.statusText;
  if (meta.errorCode) out.apiErrorCode = meta.errorCode;
  if (meta.contentType) out.apiContentType = meta.contentType;
  return out;
}
