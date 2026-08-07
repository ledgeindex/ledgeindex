import type { FastifyInstance } from "fastify";

export type RegisterDocsProfile = (fastify: FastifyInstance) => Promise<void>;

let registerDocsProfileImpl: RegisterDocsProfile | null = null;

/** Wire at app bootstrap (ledgeindex-api hosted entry). */
export function setRegisterDocsProfile(impl: RegisterDocsProfile): void {
  registerDocsProfileImpl = impl;
}

export async function registerDocsProfile(fastify: FastifyInstance): Promise<void> {
  if (!registerDocsProfileImpl) {
    throw new Error(
      "@ledgeindex/docs: call setRegisterDocsProfile() from ledgeindex-api before createLedgeIndexServer()",
    );
  }
  await registerDocsProfileImpl(fastify);
}

export const LEDGEINDEX_DOCS_VERSION = "0.0.0" as const;
