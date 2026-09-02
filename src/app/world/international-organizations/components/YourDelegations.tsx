"use client";

import { type CountryId } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { OrgCard } from "./OrgCard";
import { useEntityName } from "../useEntityName";

/**
 * The viewer's own delegations: the orgs their country is a member of (or has a
 * pending application to), shown with the shared org-card style. Each card links
 * to its page; orgs the country isn't engaged with are left to the directory.
 */
export function YourDelegations({
  orgs,
  viewer,
}: {
  orgs: OrgSummary[];
  viewer: OrgViewerInfo | null;
}) {
  const entityName = useEntityName();
  const focusCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;

  if (!focusCountry) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center">
        <p className="text-sm text-muted">
          Sign in as a head of government or foreign minister to see your country&apos;s
          delegations.
        </p>
      </div>
    );
  }

  const countryName = entityName(focusCountry);
  const mine = orgs.filter((org) => {
    const isMember = org.members.some((m) => m.countryId === focusCountry);
    const hasPending = org.pendingMembershipProposals.some(
      (p) => p.proposingCountryId === focusCountry
    );
    return isMember || hasPending;
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <CountryFlag country={focusCountry} size="lg" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Your delegations
          </p>
          <p className="text-base font-semibold text-foreground">{countryName}</p>
        </div>
      </div>

      {mine.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <p className="text-sm text-muted">
            {countryName} isn&apos;t a member of any organization yet. Browse the directory below to
            apply.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((org) => {
            const membership = org.members.find((m) => m.countryId === focusCountry);
            const ftaCount = org.activeLegislation.filter(
              (l) =>
                l.type === "free_trade_agreement" &&
                (l.parties as CountryId[]).includes(focusCountry)
            ).length;
            return (
              <OrgCard
                key={org.id}
                org={org}
                badge={membership?.status ?? "pending"}
                ftaCount={ftaCount}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
