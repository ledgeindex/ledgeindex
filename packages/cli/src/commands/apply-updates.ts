import { getCliInstance, initCliRuntime } from "../cli-runtime.js";
import { applyRuntimeFlagOverrides, loadConfig } from "../config.js";
import {
  commandArg,
  flagBool,
  flagString,
  type ParsedArgs,
} from "../parse-args.js";
import {
  createUpdatesProgressReporter,
  parseUpdatesMode,
  printUpdatesChangelog,
} from "../source-updates-io.js";

export async function runApplyUpdatesCommand(args: ParsedArgs): Promise<number> {
  const sourceToken = commandArg(args, 0);
  if (!sourceToken) {
    console.error(
      "Usage: ledgeindex apply-updates <source-id|slug> [--mode probe|discover|selected] [--json]",
    );
    return 2;
  }

  const modeRaw = flagString(args.flags, "mode");
  const mode = parseUpdatesMode(modeRaw);
  if (modeRaw && mode === null) {
    console.error("--mode must be probe, discover, or selected");
    return 2;
  }

  let config;
  try {
    config = applyRuntimeFlagOverrides(await loadConfig(), args.flags);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  await initCliRuntime(config);
  const li = getCliInstance();
  const json = flagBool(args.flags, "json");
  const reporter = createUpdatesProgressReporter(json);

  try {
    const { name } = await li.resolveSource(sourceToken);

    reporter.writeCheckStart(name, mode ?? "probe");
    const check = await li.checkForUpdates({
      source: sourceToken,
      mode: mode ?? "probe",
      onProgress: reporter.onProgress,
    });
    reporter.finish();

    if (!check.hasChanges) {
      if (json) {
        console.log(JSON.stringify({ ...check, applied: false }, null, 2));
      } else {
        printUpdatesChangelog(check.changelog);
      }
      return 0;
    }

    if (!json) {
      printUpdatesChangelog(check.changelog);
      reporter.writeApplyStart(name);
    }

    const applied = await li.applyUpdates({
      source: sourceToken,
      onProgress: reporter.onProgress,
    });

    reporter.finish();

    if (json) {
      console.log(
        JSON.stringify({ check, applied, appliedChanges: true }, null, 2),
      );
    } else {
      console.log("\nIndex updated.");
    }

    return 0;
  } catch (error) {
    reporter.fail(json);
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
