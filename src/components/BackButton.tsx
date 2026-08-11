"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface BackButtonProps {
  /** Shown when no referrer detected (direct navigation). Hidden if null. */
  fallbackLabel?: string | null;
  /** Fallback URL when using fallbackLabel */
  fallbackHref?: string;
  /** Show only the icon, hide the label text */
  iconOnly?: boolean;
}

const ROUTE_LABELS: { pattern: RegExp; label: string }[] = [
  { pattern: /\/map/, label: "Back to Map" },
  { pattern: /\/elections/, label: "Back to Elections" },
  { pattern: /\/state\//, label: "Back to State" },
  { pattern: /\/congress/, label: "Back to Congress" },
  { pattern: /\/country\/uk/, label: "Back to United Kingdom" },
  { pattern: /\/uk(\/|$)/, label: "Back to United Kingdom" },
  { pattern: /\/world/, label: "Back to World" },
];

export default function BackButton({
  fallbackLabel = null,
  fallbackHref,
  iconOnly = false,
}: BackButtonProps) {
  const router = useRouter();
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const ref = document.referrer;
    if (ref && new URL(ref).origin === window.location.origin) {
      const path = new URL(ref).pathname;
      for (const { pattern, label: lbl } of ROUTE_LABELS) {
        if (pattern.test(path)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setLabel(lbl);
          return;
        }
      }
      setLabel("Back");
    } else if (fallbackLabel) {
      setLabel(fallbackLabel);
    }
    // else stay null → hidden
  }, [fallbackLabel]);

  if (!label) return null;

  const handleClick = () => {
    if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
      router.back();
    } else if (fallbackHref) {
      router.push(fallbackHref);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={iconOnly ? label || "Back" : undefined}
      className={`transition-colors inline-flex items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${iconOnly ? "relative text-white hover:text-white/80 after:absolute after:left-1/2 after:top-1/2 after:h-10 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']" : "text-sm text-muted hover:text-foreground gap-1.5"}`}
      title={label || undefined}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      {!iconOnly && label}
    </button>
  );
}
