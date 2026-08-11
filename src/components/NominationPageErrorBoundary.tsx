"use client";

import { type ReactNode } from "react";
import { PageErrorBoundary } from "@/components/ui/PageErrorBoundary";

interface Props {
  children: ReactNode;
}

/**
 * Client-side error boundary for the nomination detail page.
 * Catches render errors before they bubble to the Congress error boundary.
 */
export function NominationPageErrorBoundary({ children }: Props) {
  return (
    <PageErrorBoundary
      pageName="Nomination page"
      errorMessage="The nomination page couldn't load. This may be a temporary issue."
      navigationLinks={[
        { href: "/congress?chamber=senate&tab=bills", label: "Back to Senate Bills" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
    >
      {children}
    </PageErrorBoundary>
  );
}
