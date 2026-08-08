import { RequestContext } from "@mastra/core/request-context";
import { getMcpAuthContext } from "./mcp-auth-context.js";

function applyMcpUserToContext(ctx: RequestContext, userId: string, token?: string) {
  ctx.set("user_id", userId);
  ctx.set("userId", userId);
  if (token) ctx.set("auth_token", token);
}

export function mergeRequestContextFromMcp(
  requestContext?: RequestContext,
): RequestContext {
  const ctx = requestContext ?? new RequestContext();
  const auth = getMcpAuthContext();
  if (auth?.userId) {
    applyMcpUserToContext(ctx, auth.userId, auth.idToken);
  }

  const mappedUser = ctx.get("user") as { id?: string } | undefined;
  if (mappedUser?.id) {
    applyMcpUserToContext(ctx, mappedUser.id);
  }

  const authInfo = ctx.get("authInfo") as
    | {
        token?: string;
        extra?: { userId?: string; access_token?: string };
      }
    | undefined;
  const token = authInfo?.token ?? authInfo?.extra?.access_token;
  if (authInfo?.extra?.userId) {
    applyMcpUserToContext(ctx, authInfo.extra.userId, token);
  } else if (token && !ctx.get("auth_token")) {
    ctx.set("auth_token", token);
  }

  return ctx;
}
