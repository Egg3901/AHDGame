"use client";

/**
 * Shared presentational primitives for {@link ExperimentalNavbar} — the
 * desktop tab styling, inline stroke icon set, and the dropdown panel/menu-row
 * building blocks used by every dropdown in the experimental nav. Pure render
 * helpers only; all state stays in the navbar itself.
 */

import React, { type RefObject } from "react";
import Link from "next/link";
import { AnchoredDropdownPanel } from "@/components/navbar/AnchoredDropdownPanel";

/**
 * Desktop primary-tab styling — text-forward tabs with a small leading icon,
 * always-visible label, and a thin underline accent for the active/open state
 * (classic-navbar organization).
 */
export function navTabClassName(active: boolean): string {
  return `relative inline-flex shrink-0 items-center rounded-lg px-3 py-2 text-[13px] transition-colors hover:text-foreground ${
    active
      ? "font-medium text-foreground after:absolute after:inset-x-3 after:bottom-1 after:h-px after:rounded-full after:bg-primary after:opacity-70"
      : "text-muted"
  }`;
}

export function isNavActive(pathname: string, href: string): boolean {
  const base = href.split("?")[0]!;
  return pathname === base || pathname.startsWith(base + "/");
}

export function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`h-3 w-3 shrink-0 transition-transform duration-500 ease-out ${open ? "rotate-180" : ""} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// Inline icons keyed by nav item — matches the design's stroke set.
export const NAV_ICONS: Record<string, React.ReactNode> = {
  Home: <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" />,
  Map: (
    <path d="M9 20l-5.4-2.7A1 1 0 013 16.4V5.6a1 1 0 011.4-.9L9 7m0 13l6-3m-6 3V7m6 10l4.6 2.3A1 1 0 0021 18.4V7.6a1 1 0 00-.6-.9L15 4m0 13V4m0 0L9 7" />
  ),
  Congress: (
    <path d="M3 6h18M8 6l-4 8a4 4 0 008 0L8 6zm8 0l-4 8a4 4 0 008 0l-4-8zM12 3v18M6 21h12" />
  ),
  Elections: <path d="M4 21V4h12l-2 4 2 4H4" />,
  News: (
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z" />
  ),
  Parties: (
    <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H2v-2a4 4 0 014-4h4a4 4 0 014 4v2M9 12a4 4 0 100-8 4 4 0 000 8zm8-4a3 3 0 11-6 0 3 3 0 016 0z" />
  ),
  World: (
    <path d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  ),
  Nation: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01" />,
  State: (
    <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  ),
  Actions: <path d="M13 10V3L4 14h7v7l9-11h-7z" />,
  Profile: <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
  Help: (
    <path d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  ),
  Staff: <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3zm-2.5 8.5l1.8 1.8 3.2-3.4" />,
};

export function NavIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_ICONS[name]}
    </svg>
  );
}

export function NavItemLabel({ children }: { children: React.ReactNode }) {
  return <span className="ml-2 whitespace-nowrap">{children}</span>;
}

export function NavItemChevron({ open }: { open: boolean }) {
  return <Chevron open={open} className="ml-1" />;
}

// ── Shared dropdown primitives ───────────────────────────────────────────────

export function DropdownPanel({
  children,
  anchorRef,
  panelRef,
  align,
  width = "w-[250px]",
  padded = true,
}: {
  children: React.ReactNode;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  align: "left" | "right";
  width?: string;
  padded?: boolean;
}) {
  return (
    <AnchoredDropdownPanel
      anchorRef={anchorRef}
      panelRef={panelRef}
      align={align}
      width={width}
      padded={padded}
    >
      {children}
    </AnchoredDropdownPanel>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
      {children}
    </div>
  );
}

export function MenuRow({
  children,
  href,
  onNavigate,
  strong = false,
  meta,
  metaClass = "text-muted",
  dot,
  nested = false,
}: {
  children: React.ReactNode;
  href: string;
  onNavigate: () => void;
  strong?: boolean;
  meta?: string;
  metaClass?: string;
  dot?: string;
  /** Indented sub-entry of the row above it, with a leading rule to tie them. */
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      role="menuitem"
      className={`flex items-center gap-2.5 rounded-lg py-2 transition-colors hover:bg-white/5 ${
        nested ? "ml-3 border-l border-card-border pl-3 pr-2.5" : "px-2.5"
      }`}
    >
      {dot && <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dot}`} />}
      <span className={`text-[13px] ${strong ? "font-medium text-foreground" : "text-fg-2"}`}>
        {children}
      </span>
      {meta && <span className={`ml-auto font-mono text-[10px] ${metaClass}`}>{meta}</span>}
    </Link>
  );
}
