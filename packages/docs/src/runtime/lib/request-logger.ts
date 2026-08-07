import chalk from "chalk";
import type { FastifyReply, FastifyRequest } from "fastify";
import { logError, logInfo, logWarn } from "./logger.js";

function shortUrl(url: string) {
  return url
    .replace("/api/sources/", "/src/")
    .replace("/api/projects/", "/prj/")
    .replace("/api/crawl-runs/", "/run/")
    .replace("/api/", "");
}

export class RequestLogger {
  static logRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    duration: number,
  ) {
    const method = request.method.substring(0, 3).padEnd(3);
    const statusColor =
      reply.statusCode >= 400
        ? "red"
        : reply.statusCode >= 300
          ? "yellow"
          : "green";

    console.log(
      chalk.bgBlue.black(`${method}`) +
        chalk.dim(` ${shortUrl(request.url)} `) +
        chalk[statusColor].bold(reply.statusCode) +
        chalk.dim(` ${duration}ms`),
    );
  }

  static logRateLimited(
    request: FastifyRequest,
    reply: FastifyReply,
    duration: number,
  ) {
    const method = request.method.substring(0, 3).padEnd(3);

    console.log(
      chalk.bgYellow.black(`${method}`) +
        chalk.dim(` ${shortUrl(request.url)} `) +
        chalk.yellow.bold(String(reply.statusCode)) +
        chalk.yellow(" rate limit") +
        chalk.dim(` ${duration}ms`),
    );

    logWarn("Rate limited", "RequestLogger", {
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      duration: `${duration}ms`,
    });
  }

  static logError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: Error,
    duration: number,
  ) {
    logError(error, "RequestLogger", {
      method: request.method,
      url: request.url,
      status: reply.statusCode || 500,
      duration: `${duration}ms`,
      errorMessage: error.message,
    });
  }

  static logDetailed(
    message: string,
    request: FastifyRequest,
    reply: FastifyReply,
    duration: number,
    data?: Record<string, unknown>,
  ) {
    logInfo(message, "RequestLogger", {
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      duration: `${duration}ms`,
      ...data,
    });
  }
}
