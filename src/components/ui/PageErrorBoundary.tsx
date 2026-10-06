"use client";

import { Component, cloneElement, Children, type ReactNode } from "react";
import Link from "next/link";
import { ErrorRef } from "@/components/ui/ErrorRef";
import { useReportedError } from "@/lib/errors/useReportedError";

interface NavigationLink {
  href: string;
  label: string;
}

interface PageErrorBoundaryProps {
  children: ReactNode;
  /** Page name for the error log (e.g., "Bill page") */
  pageName: string;
  /** Custom error message shown to users */
  errorMessage?: string;
  /** Navigation links to show in the error UI */
  navigationLinks?: NavigationLink[];
}

interface State {
  error: Error | null;
  retryKey: number;
}

function BoundaryFallback({
  error,
  pageName,
  errorMessage,
  navigationLinks,
  onRetry,
}: {
  error: Error;
  pageName: string;
  errorMessage: string;
  navigationLinks: NavigationLink[];
  onRetry: () => void;
}) {
  const reported = useReportedError(error, { logPrefix: `${pageName} error (boundary)` });
  const links = navigationLinks.some((l) => l.href === "/")
    ? navigationLinks
    : [...navigationLinks, { href: "/", label: "Home" }];
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12">
      <div className="rounded-xl border border-card-border bg-card p-8 max-w-md text-center space-y-4">
        <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted">{errorMessage}</p>
        <p className="font-mono text-xs text-muted" data-testid="error-code">
          {reported.code}
        </p>
        <ErrorRef code={reported.ref} label="Ref" />
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={onRetry}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Generic client-side error boundary for wrapping page content.
 * Catches render errors and shows a retry UI with custom navigation links.
 *
 * @example
 * <PageErrorBoundary
 *   pageName="Bill page"
 *   errorMessage="The bill page couldn't load."
 *   navigationLinks={[
 *     { href: "/congress?chamber=senate&tab=bills", label: "Back to Senate Bills" },
 *     { href: "/dashboard", label: "Dashboard" },
 *   ]}
 * >
 *   <BillDetailClient billId={billId} />
 * </PageErrorBoundary>
 */
export class PageErrorBoundary extends Component<PageErrorBoundaryProps, State> {
  constructor(props: PageErrorBoundaryProps) {
    super(props);
    this.state = { error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  handleRetry = () => {
    this.setState((s) => ({ error: null, retryKey: s.retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      const {
        errorMessage = "This page couldn't load. This may be a temporary issue.",
        navigationLinks = [{ href: "/dashboard", label: "Dashboard" }],
        pageName,
      } = this.props;

      return (
        <BoundaryFallback
          error={this.state.error}
          pageName={pageName}
          errorMessage={errorMessage}
          navigationLinks={navigationLinks}
          onRetry={this.handleRetry}
        />
      );
    }
    const child = Children.only(this.props.children);
    return cloneElement(child as React.ReactElement<{ key?: number }>, {
      key: this.state.retryKey,
    });
  }
}
