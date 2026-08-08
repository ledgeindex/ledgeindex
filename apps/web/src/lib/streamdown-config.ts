import { code } from "@streamdown/code";
import type { ComponentProps } from "react";
import type { Streamdown } from "streamdown";

/** Shared Streamdown plugins + Shiki themes for LedgeIndex chat. */
export const streamdownPlugins = { code };

export const streamdownShikiTheme = [
  "github-light",
  "github-dark",
] as const satisfies ComponentProps<typeof Streamdown>["shikiTheme"];

export const streamdownDefaultProps = {
  plugins: streamdownPlugins,
  shikiTheme: streamdownShikiTheme,
  lineNumbers: false,
  controls: {
    code: {
      copy: true,
      download: false,
    },
  },
} satisfies Partial<ComponentProps<typeof Streamdown>>;
