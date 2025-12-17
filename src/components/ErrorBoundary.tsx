import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  title?: string;
};

type ErrorBoundaryState = {
  hasError: boolean;
  errorMessage?: string;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Keep this as console logging for now; in production this can be wired to Sentry/Logflare/etc.
    console.error("[ErrorBoundary] Unhandled UI error", { error, info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-[#0f172a]/80 backdrop-blur-[12px] p-5 text-white">
            <p className="text-sm font-semibold">{this.props.title ?? "Something went wrong"}</p>
            <p className="text-xs text-white/70 mt-2">
              The UI hit an unexpected error and couldn’t render this view. Refresh the page to continue.
            </p>
            {this.state.errorMessage && (
              <p className="text-[11px] text-white/60 mt-3 break-words">Error: {this.state.errorMessage}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="h-8 px-3 rounded-lg border border-white/10 bg-white/5 text-xs hover:bg-white/10"
                onClick={() => window.location.reload()}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
