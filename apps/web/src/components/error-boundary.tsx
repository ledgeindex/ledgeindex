"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  AppErrorActions,
  AppErrorFallback,
} from "@/components/app-error-fallback";

type Props = {
  children: ReactNode;
  /** Optional label for logs / UI (e.g. "Playground"). */
  label?: string;
};

type State = {
  error: Error | null;
};

/**
 * Catches render/lifecycle crashes so we show a recoverable UI instead of a
 * blank surface. Does not catch async errors outside React's tree.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[AppErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  private reset = () => {
    this.setState({ error: null });
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <AppErrorFallback
        description={`The UI crashed while rendering${
          this.props.label ? ` (${this.props.label})` : ""
        }. Often a stale hot-reload — try again or reload the app.`}
        errorMessage={error.message || String(error)}
        actions={
          <AppErrorActions
            onRetry={this.reset}
            onSecondary={this.reload}
            secondaryLabel="Reload"
          />
        }
      />
    );
  }
}
