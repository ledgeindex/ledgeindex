import { registerAgProfileRoutes } from "./runtime/register-ag-profile.js";
import { setRegisterAgProfile } from "./register-ag-profile.js";

setRegisterAgProfile(registerAgProfileRoutes);

export {
  registerAgProfile,
  setRegisterAgProfile,
  LEDGEINDEX_AG_VERSION,
  type RegisterAgProfile,
} from "./register-ag-profile.js";
