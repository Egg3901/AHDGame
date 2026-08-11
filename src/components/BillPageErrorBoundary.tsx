"use client";

import { type ReactNode } from "react";
import { PageErrorBoundary } from "@/components/ui/PageErrorBoundary";

interface Props {
  children: ReactNode;
}

/**
 * Client-side error boundary that wraps the bill detail page.
 * Catches render errors so they don't bubble to the Congress error boundary.
 */
export function BillPageErrorBoundary({ children }: Props) {
  return (
    <PageErrorBoundary
      pageName="Bill page"
      errorMessage="The bill page couldn't load. This may be a temporary issue."
      navigationLinks={[
        { href: "/congress?chamber=senate&tab=bills", label: "Back to Senate Bills" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
    >
      {children}
    </PageErrorBoundary>
  );
}
