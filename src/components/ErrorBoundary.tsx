import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { GITHUB_ISSUES } from "@/lib/install-snippets";

interface Props {
  children: ReactNode;
  /** Changing this value resets a caught error (e.g. the current pathname). */
  resetKey?: string;
  /** Compact variant for boundaries inside a page section. */
  inline?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions so one bad payload takes down a section, not
 * the whole app. Wrapped around the router in App.tsx (keyed by pathname) and
 * usable inline around risky sections.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[singlet] render error:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const detail = error.message || String(error);
    if (this.props.inline) {
      return (
        <div role="alert" className="warning-surface p-4 text-sm">
          <p className="font-medium text-foreground">This section could not be displayed.</p>
          <p className="mt-1 font-mono text-[12px] text-muted-foreground break-words">{detail}</p>
          <button type="button" onClick={this.reset} className="btn-secondary btn-sm mt-3">
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div role="alert" className="surface max-w-[520px] w-full p-6">
          <p className="font-mono text-xs text-muted-foreground mb-2">unexpected error</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Something went wrong on this page.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The page hit an error while rendering. Reloading usually fixes it; if it keeps happening, the catalog
            may be returning something we did not expect.
          </p>
          <pre className="mt-3 p-3 bg-secondary text-[12px] font-mono text-muted-foreground whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {detail}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={this.reset} className="btn-primary btn-sm">
              Try again
            </button>
            <button type="button" onClick={() => window.location.reload()} className="btn-secondary btn-sm">
              Reload
            </button>
            <Link to="/" onClick={this.reset} className="btn-ghost btn-sm">
              Home
            </Link>
          </div>
          <p className="mt-4 text-[12.5px] text-muted-foreground">
            Keeps happening?{" "}
            <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Report it on GitHub Issues
            </a>{" "}
            with the page address and the message above.
          </p>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
