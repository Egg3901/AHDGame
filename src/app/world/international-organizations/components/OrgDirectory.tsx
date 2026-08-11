"use client";

import { type CountryId } from "@/lib/constants/countries";
import { ORGANIZATION_CATEGORIES, ORGANIZATION_CATEGORY_META } from "@/lib/constants/orgCategory";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { OrgCard } from "./OrgCard";

/** Directory of all organizations, grouped by category; each card links to its page. */
export function OrgDirectory({
  orgs,
  viewer,
}: {
  orgs: OrgSummary[];
  viewer: OrgViewerInfo | null;
}) {
  const you = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  return (
    <div className="space-y-6">
      {ORGANIZATION_CATEGORIES.map((category) => {
        const inCategory = orgs.filter((o) => o.def.category === category);
        if (inCategory.length === 0) return null;
        return (
          <section key={category} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
              {ORGANIZATION_CATEGORY_META[category].label}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {inCategory.map((org) => {
                const membership = you
                  ? org.members.find((m) => m.countryId === (you as CountryId))
                  : undefined;
                return <OrgCard key={org.id} org={org} badge={membership?.status} />;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
