/**
 * Forked child entry — Stagehand/Playwright must not run inside Electron worker threads.
 */
import {
  discoverHeaderNavPathsInternal,
  type HeaderNavProviderId,
} from "./discover-header-nav.js";

type ChildRequest = {
  url: string;
  provider?: HeaderNavProviderId;
  browserRuntime?: "playwright" | "system";
};

process.on("message", (msg: ChildRequest) => {
  void discoverHeaderNavPathsInternal(
    msg.url,
    msg.provider,
    msg.browserRuntime ?? "playwright",
  )
    .then((result) => {
      process.send?.({ ok: true, result });
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Header nav discovery failed";
      process.send?.({ ok: false, error: message });
    })
    .finally(() => {
      process.exit(0);
    });
});
