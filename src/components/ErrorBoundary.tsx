import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  // Optional fallback. If omitted, a small generic message renders. Keep
  // these very small — they go inside Suspense fallback positions, often
  // inside cards or panels with limited space.
  fallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  // Optional context label for the default message ("amortization",
  // "state data", etc.) so the boundary explains WHICH thing failed.
  label?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors and async rejections from lazy-loaded chunks.
 * Without this, a chunk that fails to load (network blip, parse error,
 * Vite asset hash mismatch after a deploy) leaves the user staring at
 * the Suspense fallback forever — no recovery, no signal.
 *
 * Place ABOVE the Suspense boundary, not below it: the boundary needs
 * to be able to render its fallback even when the lazy component never
 * mounts. A boundary inside the Suspense fallback can't catch the
 * import promise rejection.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the noise low but get something into the dev console so the
    // failure is debuggable. Production users see the fallback UI.
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error == null) return this.props.children;
    const { fallback, label } = this.props;
    if (typeof fallback === "function") {
      return fallback(error, this.retry);
    }
    if (fallback != null) return fallback;
    return (
      <div className="error-boundary-fallback" role="alert">
        <p>
          <b>Couldn't load{label ? ` ${label}` : ""}.</b> Check your
          connection or try again.
        </p>
        <button
          type="button"
          className="error-boundary-retry"
          onClick={this.retry}
        >
          Retry
        </button>
      </div>
    );
  }
}
