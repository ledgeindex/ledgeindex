import { defineLedgeindexPackageConfig } from "../tsup.base";

/** Web Cloud Build typechecks against the published package — need .d.ts. */
export default defineLedgeindexPackageConfig({
  dts: true,
});
