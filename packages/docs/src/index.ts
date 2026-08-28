import { registerDocsProfile as registerDocsProfileImpl } from "./runtime/register-docs-profile.js";
import { setRegisterDocsProfile } from "./register-docs-profile.js";

setRegisterDocsProfile(registerDocsProfileImpl);

export {
  registerDocsProfile,
  setRegisterDocsProfile,
  LEDGEINDEX_DOCS_VERSION,
  type RegisterDocsProfile,
} from "./register-docs-profile.js";

export { registerHostedInngest } from "./runtime/register-docs-profile.js";

export { createDocsMastraContribution } from "./runtime/mastra/contribution.js";
export {
  evaluateRetrievalCases,
  generateGoldenSet,
  generateRetrievalGoldenSetWorkflow,
  retrievalEvalWorkflow,
  retrievalGoldenCaseSchema,
} from "./runtime/mastra/workflows/retrieval-eval/index.js";
export type { RetrievalGoldenCase } from "./runtime/mastra/workflows/retrieval-eval/index.js";
