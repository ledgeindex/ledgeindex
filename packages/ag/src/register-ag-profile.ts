import type { FastifyInstance } from "fastify";

export type RegisterAgProfile = (fastify: FastifyInstance) => Promise<void>;

let registerAgProfileImpl: RegisterAgProfile | null = null;

export function setRegisterAgProfile(impl: RegisterAgProfile): void {
  registerAgProfileImpl = impl;
}

export async function registerAgProfile(fastify: FastifyInstance): Promise<void> {
  if (!registerAgProfileImpl) {
    throw new Error(
      "@ledgeindex/ag: call setRegisterAgProfile() from package bootstrap before createLedgeIndexServer()",
    );
  }
  await registerAgProfileImpl(fastify);
}

export const LEDGEINDEX_AG_VERSION = "0.1.0" as const;
