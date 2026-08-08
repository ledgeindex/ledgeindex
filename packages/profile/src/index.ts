import { registerProfile as registerProfileImpl } from "./runtime/profile-routes.js";
import { setRegisterProfile } from "./register-profile.js";

setRegisterProfile(registerProfileImpl);

export {
  registerProfile,
  setRegisterProfile,
  registerCompanyProfile,
  setRegisterCompanyProfile,
  LEDGEINDEX_PROFILE_VERSION,
  LEDGEINDEX_COMPANY_VERSION,
  type RegisterProfile,
  type RegisterCompanyProfile,
} from "./register-profile.js";

export { profile, profileSite, type ProfileOptions } from "./profile.js";
export {
  runCompanyProfile,
  type CompanyProfileResult,
  type CompanyProfileLensRun,
  type RunCompanyProfileInput,
  type SeedCatalogPage,
} from "./research/run-company-profile.js";
export {
  researchLensIds,
  getResearchLens,
  getLensDefinition,
  defaultProfileLenses,
  parseResearchLensList,
  PROFILE_MODE_ID,
  type ResearchLens,
  type CompanyProfileData,
  type LensOutputById,
  type CapabilitiesLensOutput,
  type IdentityLensOutput,
  type DocsIdentityLensOutput,
  type PricingLensOutput,
} from "./research/research-lenses.js";
