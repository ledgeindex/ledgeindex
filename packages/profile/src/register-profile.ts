import type { FastifyInstance } from "fastify";

export type RegisterProfile = (fastify: FastifyInstance) => Promise<void>;

let registerProfileImpl: RegisterProfile | null = null;

export function setRegisterProfile(impl: RegisterProfile): void {
  registerProfileImpl = impl;
}

export async function registerProfile(fastify: FastifyInstance): Promise<void> {
  if (!registerProfileImpl) {
    return;
  }
  await registerProfileImpl(fastify);
}

/** @deprecated Use registerProfile */
export const registerCompanyProfile = registerProfile;
/** @deprecated Use setRegisterProfile */
export const setRegisterCompanyProfile = setRegisterProfile;
/** @deprecated Use RegisterProfile */
export type RegisterCompanyProfile = RegisterProfile;

export const LEDGEINDEX_PROFILE_VERSION = "0.0.0" as const;
/** @deprecated Use LEDGEINDEX_PROFILE_VERSION */
export const LEDGEINDEX_COMPANY_VERSION = LEDGEINDEX_PROFILE_VERSION;
