import type { FastifyReply } from "fastify";

export const PROBLEM_JSON = "application/problem+json";

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance?: string;
  error: string;
};

const TITLE_BY_STATUS: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

export function problemTypeUrl(code: string): string {
  const slug = code.toLowerCase().replace(/_/g, "-");
  return `https://ledgeindex.com/problems/${slug}`;
}

export function buildProblemDetails(params: {
  status: number;
  code: string;
  detail: string;
  title?: string;
  instance?: string;
}): ProblemDetails {
  const title = params.title ?? TITLE_BY_STATUS[params.status] ?? "Error";
  return {
    type: problemTypeUrl(params.code),
    title,
    status: params.status,
    detail: params.detail,
    code: params.code,
    ...(params.instance ? { instance: params.instance } : {}),
    error: params.detail,
  };
}

export function sendProblem(
  reply: FastifyReply,
  params: {
    status: number;
    code: string;
    detail: string;
    title?: string;
  },
) {
  const body = buildProblemDetails(params);
  return reply
    .code(params.status)
    .type(PROBLEM_JSON)
    .send(body);
}
