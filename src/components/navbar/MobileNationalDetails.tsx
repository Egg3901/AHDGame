"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { type CountryId } from "@/lib/constants/countries";
import {
  buildNationalDetailsSections,
  type NationDetailItem,
  type NationDetailsOpts,
} from "./nationDetailsSections";
import { NATION_DETAIL_ICONS } from "./nationDetailIcons";
import { CollapsibleNavSection } from "./CollapsibleNavSection";
import { useActivePresidentElection } from "@/hooks/useActivePresidentElection";

/** Active when the current path is the link target or nested under it. */
function isActive(pathname: string, href: string): boolean {
  const base = href.split("?")[0];
  return pathname === base || pathname.startsWith(base + "/");
}

const isPinnedItem = (item: NationDetailItem) => item.id === "map";

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
  const t = useTranslations("nav");
  const pathname = usePathname();
  // Scope the presidential-election quick-link to the viewed country (the global
  // opts value is the US race). The mobile menu only mounts when open, so fetch.
  const activePresidentElection = useActivePresidentElection(countryId, true);
  const sections = buildNationalDetailsSections(countryId, { ...opts, activePresidentElection });
  // Map is a top-five destination, so it sits outside the collapsed groups
  // instead of hiding under "Other". A group left empty by that is dropped.
  const pinnedItems = sections.flatMap((section) => section.items.filter(isPinnedItem));
  const groups = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !isPinnedItem(item)) }))
    .filter((section) => section.items.length > 0);
  const renderLink = (item: NationDetailItem) => {
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
        {item.labelKey ? t(item.labelKey) : item.label}
      </Link>
    );
  };
  return (
    <>
      {pinnedItems.map(renderLink)}
      {groups.map((section) => (
        <CollapsibleNavSection
          key={section.title}
          title={t(section.titleKey)}
          collapsible
          // Economy is the group players reach for most after Map, so it opens
          // by default rather than reading as a hidden dropdown.
          defaultOpen={section.title === "Economy"}
          className="mt-2"
          labelClassName="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted/70"
        >
          {section.items.map(renderLink)}
        </CollapsibleNavSection>
      ))}
    </>
  );
}
