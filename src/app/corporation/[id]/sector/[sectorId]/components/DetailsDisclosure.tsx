"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface DetailsDisclosureProps {
  /** Short trigger text. Defaults to "Details". */
  label?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Progressive disclosure for the plants panels: the loop numbers stay on the
 * surface, the modifier maths lives one tap down. Native `details` semantics via
 * a button + region so it keyframes and stays keyboard reachable.
 */
export default function DetailsDisclosure({
  label = "Details",
  children,
  className,
}: DetailsDisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-body-xs font-semibold uppercase tracking-wider text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
      >
        {label}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          className="mt-2 rounded-lg border border-card-border bg-card-muted/60 p-3"
        >
          {children}
        </div>
      )}
    </div>
  );
}
