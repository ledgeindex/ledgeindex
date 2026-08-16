import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyFirebaseIdToken } from "../lib/firebase-admin.js";
import { isRawApiKeyValue } from "../lib/api-keys.js";
import {
  ApiKeyLimitError,
  createUserApiKey,
  ensurePlaygroundApiKey,
  getApiKeyLimitForUser,
  listUserApiKeys,
  LIVE_API_KEY_NAME,
  normalizeUserApiKeys,
  revokeUserApiKey,
} from "../services/api-key-store.js";
import { getUserRole, isAdminRole } from "../services/user-role.js";
import { getUserAccessStatus } from "../services/user-access.js";
import { isPlanLimitsEnabled } from "../services/source-set-limits.js";
import { getUserPlan } from "../services/user-plan.js";

const createApiKeySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => !isRawApiKeyValue(value), {
      message: "Use a label like Live — not the key value.",
    })
    .optional(),
});

async function requireFirebaseUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ uid: string; email: string | null } | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Firebase login required" });
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    const decoded = await verifyFirebaseIdToken(token);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    reply.code(401).send({ error: "Invalid or expired token" });
    return null;
  }
}

export async function apiKeyRoutes(fastify: FastifyInstance) {
  fastify.get("/api/auth/me", async (request, reply) => {
    const user = await requireFirebaseUser(request, reply);
    if (!user) return;

    const [role, accessStatus, plan] = await Promise.all([
      getUserRole(user.uid),
      getUserAccessStatus(user.uid),
      getUserPlan(user.uid),
    ]);
    return {
      role,
      accessStatus,
      plan,
      planLimitsEnabled: isPlanLimitsEnabled(),
    };
  });

  fastify.get("/api/auth/api-keys", async (request, reply) => {
    const user = await requireFirebaseUser(request, reply);
    if (!user) return;

    const role = await getUserRole(user.uid);
    await normalizeUserApiKeys(user.uid);
    const data = await listUserApiKeys(user.uid);
    const limit = await getApiKeyLimitForUser(user.uid);

    return {
      success: true,
      data,
      meta: {
        api_key_limit: limit,
        current_count: data.length,
        can_create: isAdminRole(role),
        can_revoke: isAdminRole(role),
      },
    };
  });

  fastify.post("/api/auth/api-keys/ensure-playground", async (request, reply) => {
    const user = await requireFirebaseUser(request, reply);
    if (!user) return;

    const result = await ensurePlaygroundApiKey(user.uid);
    await normalizeUserApiKeys(user.uid);
    const data = await listUserApiKeys(user.uid);

    return reply.status(result.created ? 201 : 200).send({
      success: true,
      data,
      ...(result.created && result.apiKey ? { provisioned_key: result.apiKey } : {}),
    });
  });

  fastify.post("/api/auth/api-keys", async (request, reply) => {
    const user = await requireFirebaseUser(request, reply);
    if (!user) return;

    const role = await getUserRole(user.uid);
    if (!isAdminRole(role)) {
      return reply.status(403).send({
        success: false,
        error: "Only admins can create additional API keys",
        message: "Your Playground key is provisioned automatically.",
      });
    }

    const body = createApiKeySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    try {
      const created = await createUserApiKey(
        user.uid,
        body.data.name?.trim() || LIVE_API_KEY_NAME,
      );
      return reply.status(201).send({
        success: true,
        data: {
          apiKey: created.apiKey,
          keyId: created.keyId,
          name: created.record.name,
          scopes: created.record.scopes,
        },
        message: "API key generated successfully",
      });
    } catch (error) {
      if (error instanceof ApiKeyLimitError) {
        return reply.status(403).send({
          success: false,
          error: "API key limit reached",
          message: `You can only have ${error.limit} API keys.`,
          current: error.current,
          limit: error.limit,
        });
      }
      throw error;
    }
  });

  fastify.delete("/api/auth/api-keys/:keyId", async (request, reply) => {
    const user = await requireFirebaseUser(request, reply);
    if (!user) return;

    const role = await getUserRole(user.uid);
    if (!isAdminRole(role)) {
      return reply.status(403).send({
        success: false,
        error: "Only admins can revoke API keys",
      });
    }

    const { keyId } = request.params as { keyId: string };
    const revoked = await revokeUserApiKey(user.uid, keyId);
    if (!revoked) {
      return reply.status(404).send({ error: "API key not found" });
    }

    return { success: true, message: "API key revoked" };
  });
}
