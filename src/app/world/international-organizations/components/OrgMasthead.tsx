"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui";
import type { CountryId } from "@/lib/constants/countries";
import { ORGANIZATION_CATEGORY_META } from "@/lib/constants/orgCategory";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { orgHref } from "../orgRouting";
import { orgAccentStyle } from "./orgTheme";
import { Seal, MetricTile } from "./OrgPrimitives";
import { formatFundAmount } from "./fundCurrency";

function viewerCountry(viewer: OrgViewerInfo | null): CountryId | null {
  return viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
}

export function OrgMasthead({
  org,
  viewer,
  alignmentEnabled = false,
}: {
  org: OrgSummary;
  viewer: OrgViewerInfo | null;
  /** Gates the Influence tab. Fail-closed: absent means off. */
  alignmentEnabled?: boolean;
}) {
  const { identity, def, derived } = org;
  const pathname = usePathname();
  const base = orgHref(org);
  const { formatAmount } = useCurrency();

  /**
   * A fund-currency amount, shown in whatever currency the viewer prefers.
   *
   * `formatAmount` works in anchor units, and `usdToFundRate` is anchor-per-
   * fund-unit — resolved server-side for the active era, because deriving it
   * from `COUNTRY_CONFIGS` here would price a 1953 world at 1979 rates. Absent
   * (older cached payloads, test fixtures), fall back to the fund's own
   * currency rather than guessing a rate.
   */
  const formatFundIncome = (localAmount: number): string =>
    org.fund.usdToFundRate
      ? formatAmount(localAmount * org.fund.usdToFundRate, org.fund.currencyCode as CurrencyCode)
      : formatFundAmount(localAmount, org.fund.currencyCode);
  const you = viewerCountry(viewer);
  const yourMembership = you ? org.members.find((m) => m.countryId === you) : undefined;
  const yourInfluence = you
    ? (derived.members.find((m) => m.countryId === you)?.influenceIndex ?? 0)
    : 0;
  const lead = org.leadership;
  const activeFtas = org.activeLegislation.filter((l) => l.type === "free_trade_agreement").length;
  const pendingCount =
    org.pendingLegislation.length +
    org.pendingMembershipProposals.length +
    org.pendingLeadershipElections.length;

  // Influence appears only when bloc alignment is switched on — a world with the
  // gate off must show no trace of the feature. Once on it shows for EVERY org,
  // including those with no channel this era, which explain why rather than
  // appearing and disappearing between eras.
  const subTabs: { seg: "overview" | "flagship" | "influence"; label: string }[] = [
    { seg: "overview", label: "Overview" },
    { seg: "flagship", label: ORGANIZATION_CATEGORY_META[def.category].flagshipLabel },
    ...(alignmentEnabled ? [{ seg: "influence" as const, label: "Influence" }] : []),
  ];

  return (
    <header
      className="relative overflow-hidden rounded-2xl border bg-card shadow-card"
      style={{
        ...orgAccentStyle(identity),
        borderColor: "color-mix(in srgb, var(--org) 25%, transparent)",
      }}
    >
      <div
        className="relative px-5 pt-5 sm:px-7 sm:pt-6"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--org) 14%, rgb(var(--c-card))), rgb(var(--c-card)))",
        }}
      >
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <Seal identity={identity} size={76} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              {identity.group}
              {identity.hq !== "—" && ` · HQ ${identity.hq}`}
              {identity.founded > 0 && ` · est. ${identity.founded}`}
            </div>
            <h1 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-[28px]">
              {def.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {lead?.holderCharacterName ? (
                <Badge color="default" variant="outline">
                  {def.leadership.title}: {lead.holderCharacterName}
                </Badge>
              ) : (
                <Badge color="default" variant="outline">
                  {def.leadership.title}: vacant
                </Badge>
              )}
              <Badge color="info" variant="subtle">
                {org.members.length} member{org.members.length === 1 ? "" : "s"}
              </Badge>
              {yourMembership && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    borderColor: "color-mix(in srgb, var(--org) 40%, transparent)",
                    color: "var(--org-soft)",
                  }}
                >
                  Your seat · {yourMembership.status === "founding" ? "Founding" : "Member"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* sub-tab nav (routed) */}
        <div className="relative -mb-px mt-4 flex gap-5 overflow-x-auto">
          {subTabs.map((t) => {
            const active = pathname?.endsWith(`/${t.seg}`) ?? false;
            return (
              <Link
                key={t.seg}
                href={`${base}/${t.seg}`}
                className={`whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-[13px] font-semibold transition-colors ${
                  active ? "text-foreground" : "border-transparent text-muted hover:text-foreground"
                }`}
                style={active ? { borderColor: "var(--org)" } : undefined}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* metric strip */}
      <div className="grid grid-cols-2 divide-x divide-y divide-card-border border-t border-card-border bg-card-muted/60 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        <MetricTile
          label="Bloc weight"
          value={`${derived.worldEconomySharePct}%`}
          sub="of world economy"
          accent
        />
        <MetricTile label="Your influence" value={`${yourInfluence}`} sub="your standing" accent />
        <MetricTile label="Members" value={`${org.members.length}`} sub="states" />
        <MetricTile label="Active FTAs" value={`${activeFtas}`} sub="in force" />
        <MetricTile label="Pending" value={`${pendingCount}`} sub="resolutions" />
        <MetricTile
          label="Org fund"
          value={formatFundAmount(org.fund.balanceLocal, org.fund.currencyCode)}
          sub={fundIncomeSummary(org.fund, formatFundIncome)}
          accent
        />
      </div>

      {/* acting chip */}
      {viewer && you && (
        <div className="flex items-center justify-between gap-2 border-t border-card-border bg-card px-4 py-2.5">
          <span className="text-[12px] text-muted">
            Acting as{" "}
            <span className="font-semibold text-foreground">
              {yourMembership ? def.shortName : "non-member"}
            </span>{" "}
            delegation
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            style={{
              borderColor: "color-mix(in srgb, var(--org) 40%, transparent)",
              color: "var(--org-soft)",
            }}
          >
            {viewer.diplomaticActionsRemaining} / {viewer.diplomaticActionsPerTurn} diplomatic
            actions left
          </span>
        </div>
      )}
    </header>
  );
}

/**
 * What the fund takes in each year, and from whom.
 *
 * Dues and tribute are separate lines because they are separate bargains: the
 * voting members set the dues they pay, while members without a vote pay a fixed
 * tribute they have no say in. Showing only the dues understated an armed bloc's
 * real income badly — in 1953 NATO's tribute payers out-earn its voters — and
 * showed a total nobody was actually charged.
 *
 * These two follow the viewer's display-currency preference; the BALANCE beside
 * them deliberately does not. A balance is an account — you cannot spend dollars
 * out of the Warsaw Pact's fund, and the commit input has to be in the units the
 * API accepts — but an annual income figure is informational, and ₽2.26bn means
 * nothing to a player with no stake in the rouble.
 *
 * Orgs that levy no tribute (the UN, the Commonwealth, anything outside a 1953
 * world) keep the single-line form rather than carrying a permanent zero.
 */
function fundIncomeSummary(
  fund: OrgSummary["fund"],
  format: (localAmount: number) => string
): string {
  const dues = `${format(fund.annualDuesLocal ?? 0)}/yr dues`;
  const tribute = fund.annualTributeLocal ?? 0;
  if (tribute <= 0) {
    return `${dues} · ${(fund.duesRateAnnual * 100).toFixed(3)}%`;
  }
  return `${dues} · ${format(tribute)}/yr tribute`;
}
