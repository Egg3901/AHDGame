"use client";

import type { ReactNode } from "react";

type SectionAccent = "primary" | "success" | "info";

const SECTION_ACCENT: Record<SectionAccent, string> = {
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  info: "bg-info/15 text-info",
};

interface CeoOfficeSectionProps {
  title: string;
  sub?: string;
  icon: ReactNode;
  accent?: SectionAccent;
  children: ReactNode;
}

export function CeoOfficeSection({
  title,
  sub,
  icon,
  accent = "primary",
  children,
}: CeoOfficeSectionProps) {
  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      <div
        className={`flex items-center gap-3 border-b border-card-border px-4 py-3 sm:px-5 ${
          accent === "success" ? "bg-success/5" : accent === "info" ? "bg-info/5" : "bg-primary/5"
        }`}
      >
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${SECTION_ACCENT[accent]}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-foreground truncate">{title}</h2>
          {sub && <p className="text-[11px] text-muted truncate">{sub}</p>}
        </div>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function CeoGearButton({
  onClick,
  className = "",
  label = "Corporation settings",
}: {
  onClick: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`rounded-lg border border-card-border bg-card-elevated p-2 text-muted hover:text-foreground hover:bg-card transition-colors ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
