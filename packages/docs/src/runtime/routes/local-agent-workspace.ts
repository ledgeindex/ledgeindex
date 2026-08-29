import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/resource-access.js";
import {
  LocalAgentSelectionError,
  localAgentSelectionSchema,
} from "../mastra/local-source-workspace/selection.js";
import { prepareLocalSourceWorkspace } from "../mastra/local-source-workspace/workspace.js";

const prepareBodySchema = z.object({
  selection: localAgentSelectionSchema,
});

export async function localAgentWorkspaceRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post(
    "/api/playground/local-agent-workspace/prepare",
    async (request, reply) => {
      const userId = await requireUser(request, reply);
      if (!userId) return;

      const parsed = prepareBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          status: "unavailable",
          reason: "invalid-selection",
          message: "Select local knowledge before using Agent mode.",
        });
      }

      try {
        const prepared = await prepareLocalSourceWorkspace({
          selection: parsed.data.selection,
          userId,
        });
        return {
          status: "ready",
          workspaceKey: prepared.key,
          sourceCount: prepared.sourceCount,
          pageCount: prepared.pageCount,
          fileCount: prepared.fileCount,
          byteCount: prepared.byteCount,
          cacheHit: prepared.cacheHit,
        };
      } catch (error) {
        if (error instanceof LocalAgentSelectionError) {
          const statusCode =
            error.code === "source-not-found" ||
            error.code === "source-set-not-found"
              ? 404
              : error.code === "not-local"
                ? 403
                : 400;
          return reply.status(statusCode).send({
            status: "unavailable",
            reason: error.code,
            message: error.message,
          });
        }
        throw error;
      }
    },
  );
}
