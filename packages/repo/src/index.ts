export const LEDGEINDEX_REPO_VERSION = "0.1.0" as const;

export { REPO_EXPLORE_MAX_STEPS } from "./constants.js";

export {
  createRepoExploreAgent,
  type CreateRepoExploreAgentInput,
} from "./agents/repo-explore-agent.js";

export {
  EnsureFinalResponseProcessor,
} from "./processors/ensure-final-response.js";

export {
  createRepoFsTools,
  type RepoFsTools,
} from "./tools/repo-fs-tools.js";

export {
  repoExploreOutputSchema,
  type RepoExploreOutput,
  type RepoMainUsageExample,
} from "./schemas.js";

export {
  exploreRepoExamples,
  type ExploreRepoExamplesInput,
  type ExploreRepoExamplesResult,
} from "./explore-repo-examples.js";

export {
  repoPrimitiveKindSchema,
  repoPrimitiveSchema,
  repoProfileExampleSchema,
  repoProfileCoreSchema,
  repoProfileExamplesSchema,
  repoProfileSchema,
  type RepoPrimitive,
  type RepoProfileExample,
  type RepoProfileCore,
  type RepoProfile,
} from "./profile-schemas.js";

export {
  createRepoProfilerExploreAgent,
  type CreateRepoProfilerExploreAgentInput,
} from "./agents/repo-profiler-explore-agent.js";

export {
  profileRepo,
  type ProfileRepoInput,
  type ProfileRepoResult,
} from "./profile-repo.js";

export {
  REPO_INDEXABLE_EXTENSIONS,
  REPO_SKIP_DIR_NAMES,
  isRepoIndexableFile,
  repoChunkLanguageForFile,
  contentTypeForRepoFile,
  type RepoChunkLanguage,
} from "./indexable-paths.js";

export { listRepoIndexableFiles, type WalkRepoOptions } from "./walk-repo.js";

export {
  repoFileCanonicalUrl,
  githubHttpsUrlFromCloneUrl,
  repoSourceSlugFromGithubUrl,
} from "./repo-page-url.js";

export {
  REPO_MAX_FILE_BYTES,
  loadRepoIndexPages,
  indexRepoCheckout,
  type IndexRepoCheckoutInput,
  type LoadRepoIndexPagesResult,
} from "./index-repo-checkout.js";
