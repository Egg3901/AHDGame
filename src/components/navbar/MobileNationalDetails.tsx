"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CountryId } from "@/lib/constants/countries";
import { buildNationalDetailsSections, type NationDetailsOpts } from "./nationDetailsSections";
import { NATION_DETAIL_ICONS } from "./nationDetailIcons";
import { CollapsibleNavSection } from "./CollapsibleNavSection";
import { useActivePresidentElection } from "@/hooks/useActivePresidentElection";

/** Active when the current path is the link target or nested under it. */
function isActive(pathname: string, href: string): boolean {
  const base = href.split("?")[0];
  return pathname === base || pathname.startsWith(base + "/");
}

/**
 * Mobile hamburger-menu rendering of the National Details links, grouped into
 * the same four sub-sections as the desktop dropdown (shared builder + icons).
 * Highlights the active page (parity with the previous flat mobile list).
 * `onNavigate` closes the mobile menu on tap.
 */
export function MobileNationalDetails({
  countryId,
  onNavigate,
  ...opts
}: { countryId: CountryId; onNavigate: () => void } & NationDetailsOpts) {
  const pathname = usePathname();
  // Scope the presidential-election quick-link to the viewed country (the global
  // opts value is the US race). The mobile menu only mounts when open, so fetch.
  const activePresidentElection = useActivePresidentElection(countryId, true);
  return (
    <>
      {buildNationalDetailsSections(countryId, { ...opts, activePresidentElection }).map(
        (section) => (
          <CollapsibleNavSection
            key={section.title}
            title={section.title}
            // Every section collapses by default on mobile (regardless of
            // `section.collapsible`, which only Economy sets — that flag
            // still gates the desktop dropdowns, left untouched here). A
            // user can't tell a section is collapsible at all unless it
            // reads as a button, so all four get the same chevron affordance.
            collapsible
            // A collapsed group would hide the active-page highlight this list
            // exists to show, so open the group holding the current route.
            defaultOpen={section.items.some((item) => isActive(pathname, item.href))}
            className="mt-2"
            labelClassName="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted/70"
          >
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 hover:text-foreground ${
                    active ? "bg-white/5 font-medium text-foreground" : "text-muted"
                  }`}
                >
                  {NATION_DETAIL_ICONS[item.id]}
                  {item.label}
                </Link>
              );
            })}
          </CollapsibleNavSection>
        )
      )}
    </>
  );
}
