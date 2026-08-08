import type { FastifyReply, FastifyRequest } from "fastify";
import { getStore } from "../db/index.js";
import type { Project, Source } from "../db/types.js";
import { isApiAuthRequired } from "./firebase-admin.js";
import { getUserRole, isAdminRole, type UserRole } from "../services/user-role.js";
import { resolveSourceRefForUser } from "../services/source-resolve.js";

export function getRequestUserId(request: FastifyRequest): string | null {
  return request.user?.uid ?? null;
}

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const userId = getRequestUserId(request);
  if (!userId) {
    reply.code(401).send({ error: "Authentication required" });
    return null;
  }
  return userId;
}

export async function getRequestUserRole(
  request: FastifyRequest,
): Promise<UserRole> {
  const userId = getRequestUserId(request);
  if (!userId) return "user";
  return getUserRole(userId);
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const role = await getRequestUserRole(request);
  if (!isAdminRole(role)) {
    reply.code(403).send({ error: "Admin access required" });
    return false;
  }
  return true;
}

export function isProjectOwnedBy(project: Project, userId: string): boolean {
  return project.ownerUserId === userId;
}

export function isGlobalSource(source: Source): boolean {
  return source.scope === "global";
}

export async function isPersonalSourceOwnedBy(
  source: Source,
  userId: string,
): Promise<boolean> {
  if (isGlobalSource(source)) return false;
  const project = await getStore().getProject(source.projectId);
  return Boolean(project && isProjectOwnedBy(project, userId));
}

export async function canReadSource(
  source: Source,
  userId: string,
): Promise<boolean> {
  if (isGlobalSource(source)) return true;
  return isPersonalSourceOwnedBy(source, userId);
}

export async function canWriteSource(
  source: Source,
  userId: string,
  role: UserRole,
): Promise<boolean> {
  if (!isApiAuthRequired()) {
    return canReadSource(source, userId);
  }
  if (isGlobalSource(source)) {
    return isAdminRole(role);
  }
  return isPersonalSourceOwnedBy(source, userId);
}

export async function getProjectForUser(
  projectId: string,
  userId: string,
): Promise<Project | null> {
  const project = await getStore().getProject(projectId);
  if (!project || !isProjectOwnedBy(project, userId)) {
    return null;
  }
  return project;
}

export async function getSourceForUser(
  sourceId: string,
  userId: string,
): Promise<Source | null> {
  const source = await resolveSourceRefForUser(sourceId, userId);
  return source;
}

export async function getSourceForWrite(
  sourceRef: string,
  userId: string,
  role: UserRole,
): Promise<Source | null> {
  const source = await resolveSourceRefForUser(sourceRef, userId);
  if (!source) return null;
  if (!(await canWriteSource(source, userId, role))) {
    return null;
  }
  return source;
}

export async function listProjectsForUser(userId: string): Promise<Project[]> {
  return getStore().listProjects(userId);
}

export async function listSourcesForUser(userId: string): Promise<Source[]> {
  return getStore().listPersonalSourcesForOwner(userId);
}
