import type { Mastra } from "@mastra/core/mastra";
import { getMastra, setMastraInstance, tryGetMastra } from "./instance.js";
import { createDocsMastraContribution } from "./contribution.js";
import { createStandaloneDocsMastra } from "./standalone-mastra.js";

export { setMastraInstance, getMastra, tryGetMastra } from "./instance.js";
export { createDocsMastraContribution } from "./contribution.js";

/** Tests / scripts without merged server bootstrap. */
export function bootstrapStandaloneDocsMastra(): Mastra {
  const existing = tryGetMastra();
  if (existing) return existing;
  const instance = createStandaloneDocsMastra();
  setMastraInstance(instance);
  return instance;
}

/**
 * Back-compat export — resolves after {@link setMastraInstance} (server merge or bootstrap).
 */
export const mastra = new Proxy({} as Mastra, {
  get(_target, prop) {
    const instance = getMastra();
    const value = (instance as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});
