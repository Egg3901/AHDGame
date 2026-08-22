"use client";

import { Badge } from "@/components/ui";
import { ORGANIZATION_CATEGORY_META } from "@/lib/constants/orgCategory";
import { DEFENSE_PLEDGE_TARGET_PCT, POSTURE_META } from "@/lib/constants/orgPosture";
import { getDirectiveDef } from "@/lib/constants/orgDirectives";
import { getAgencyDef } from "@/lib/constants/orgAgencies";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { OrganizationResolutionType } from "@/lib/db/types/internationalOrganization";
import type { OrgSummary } from "../orgTypes";
import { MetricTile } from "./OrgPrimitives";
import { formatFundAmount } from "./fundCurrency";
import { useFundFormatter } from "./useFundFormatter";

/**
 * Per-org "flagship" tab, dispatched by the org's category (political →
 * assembly, economic → market, security → alliance, development → development).
 * Built-ins are instances of their category; custom orgs get the same template.
 * Phase 1B renders the design's layout as a display scaffold using real
 * membership/derived data; the bespoke *mechanics* (agency funding, alert
 * posture, 2%-pledge, directives, sanctions, veto) land in Phase 2.
 */

/**
 * Keyed by `OrganizationResolutionType`, not `string`: the Charter Powers chips
 * render straight off the category's `powers` list, so a type added there without
 * a label here shows the raw enum value to the player. Typed this way it does not
 * compile until the label exists.
 */
const POWER_LABEL: Record<OrganizationResolutionType, string> = {
  free_trade_agreement: "Free-trade agreements",
  sanctions: "Sanctions",
  directive: "Directives",
  joint_statement: "Joint statements",
  aid_package: "Aid packages",
  set_posture: "Alert posture",
  fund_agency: "Agency funding",
  set_dues: "Dues",
  join_conflict: "Entry into conflicts",
};

function Section({
  title,
  sub,
  right,
  children,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {sub && <div className="text-[11px] text-muted">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Charter powers granted by the org's category (shared across all flagships). */
function CharterPowers({ org }: { org: OrgSummary }) {
  const powers = ORGANIZATION_CATEGORY_META[org.def.category].powers;
  return (
    <Section title="Charter powers" sub="Resolution types this organization may pass">
      <div className="flex flex-wrap gap-1.5">
        {powers.map((p) => (
          <Badge key={p} color="info" variant="subtle">
            {POWER_LABEL[p] ?? p}
          </Badge>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Table and vote these resolutions from the Overview tab.
      </p>
    </Section>
  );
}

function PoliticalAssembly({ org, currentTurn }: { org: OrgSummary; currentTurn?: number }) {
  const permanent = org.def.foundingMembers;
  const seats = org.members.filter((m) => (permanent as string[]).includes(m.countryId));
  const funded = org.activeLegislation.filter((l) => l.type === "fund_agency");
  const fundDisplay = formatFundAmount(org.fund.balanceLocal, org.fund.currencyCode);
  return (
    <div className="space-y-4">
      <Section title="Permanent council" sub="Founding members hold the permanent seats">
        {seats.length === 0 ? (
          <p className="text-[13px] text-muted">No permanent members.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {seats.map((m) => (
              <div
                key={m.countryId}
                className="rounded-lg border border-card-border bg-card-muted p-2.5 text-center"
              >
                <div className="text-2xl">{m.flagEmoji}</div>
                <div className="mt-1 truncate text-[11px] font-semibold text-foreground">
                  {m.countryName}
                </div>
                <Badge color="info" variant="subtle" className="mt-1">
                  Permanent
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section
        title="Funded agencies"
        sub={`Global programmes funded from the pooled treasury (${fundDisplay})`}
      >
        {funded.length === 0 ? (
          <p className="text-[13px] text-muted">No agencies funded.</p>
        ) : (
          <div className="space-y-2">
            {funded.map((l) => {
              const def = getAgencyDef(l.agencyKey);
              const turnsLeft =
                currentTurn != null && l.agencyExpiresOnTurn != null
                  ? Math.max(0, l.agencyExpiresOnTurn - currentTurn)
                  : null;
              return (
                <div
                  key={l._id.toString()}
                  className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted p-3"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-foreground">
                      {def?.label ?? l.title}
                    </div>
                    {def?.blurb && <div className="text-[11px] text-muted">{def.blurb}</div>}
                  </div>
                  {turnsLeft != null && (
                    <span className="shrink-0 text-[11px] text-muted">
                      Lapses in {turnsLeft} turn{turnsLeft === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">Fund agencies from the Overview tab.</p>
      </Section>
    </div>
  );
}

function SecurityAlliance({ org }: { org: OrgSummary }) {
  const target = DEFENSE_PLEDGE_TARGET_PCT;
  const withPct = org.members.map((m) => ({
    ...m,
    pct: org.defensePctByCountry[m.countryId],
  }));
  const metCount = withPct.filter((m) => m.pct !== undefined && m.pct >= target).length;
  const rated = withPct.filter((m) => m.pct !== undefined).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Members" value={`${org.members.length}`} sub="allies" accent />
        <MetricTile
          label="Bloc weight"
          value={`${org.derived.worldEconomySharePct}%`}
          sub="of world economy"
        />
        <MetricTile
          label="Defense pledge"
          value={`${metCount}/${rated || org.members.length}`}
          sub={`meet ${target}% GDP`}
        />
        <MetricTile
          label="Alert posture"
          value={POSTURE_META[org.posture].label}
          sub="alliance-wide"
          accent={org.posture !== "standard"}
        />
      </div>

      <Section
        title="Alert posture"
        sub="Alliance-wide footing, set by a member vote (Overview → Alert posture)"
      >
        <p className="text-[13px] text-foreground">{POSTURE_META[org.posture].blurb}</p>
      </Section>

      <Section
        title="Defense-spending pledge"
        sub={`Members' defense outlay vs the ${target}%-of-GDP target`}
      >
        <div className="space-y-2">
          {withPct.map((m) => {
            const has = m.pct !== undefined;
            const pct = m.pct ?? 0;
            const met = has && pct >= target;
            // Bar scaled to a 0–4% window (target sits at the half mark).
            const width = Math.min(100, (pct / (target * 2)) * 100);
            return (
              <div key={m.countryId} className="flex items-center gap-3">
                <span className="flex w-40 shrink-0 items-center gap-1.5 text-[12px] text-foreground">
                  <span>{m.flagEmoji}</span> {m.countryName}
                </span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-background">
                  <div
                    className={`h-full rounded-full ${met ? "bg-success" : "bg-warning"}`}
                    style={{ width: `${width}%` }}
                  />
                  {/* 2% target marker at the half mark. */}
                  <div className="absolute inset-y-0 left-1/2 w-px bg-card-border" />
                </div>
                <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-foreground">
                  {has ? `${pct.toFixed(1)}%` : "n/a"}
                </span>
                {has ? (
                  met ? (
                    <Badge color="success" variant="subtle">
                      Met
                    </Badge>
                  ) : (
                    <Badge color="warning" variant="subtle">
                      Below
                    </Badge>
                  )
                ) : (
                  <Badge color="default" variant="subtle">
                    No budget
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function EconomicMarket({ org, currentTurn }: { org: OrgSummary; currentTurn?: number }) {
  const activeFtas = org.activeLegislation.filter((l) => l.type === "free_trade_agreement");
  const directives = org.activeLegislation.filter((l) => l.type === "directive");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Members" value={`${org.members.length}`} sub="states" accent />
        <MetricTile label="Active FTAs" value={`${activeFtas.length}`} sub="in force" />
        <MetricTile label="Directives" value={`${directives.length}`} sub="in force" />
        <MetricTile
          label="Bloc weight"
          value={`${org.derived.worldEconomySharePct}%`}
          sub="of world economy"
        />
      </div>

      <Section title="Directives in force" sub="Bloc-wide policies shifting member metrics">
        {directives.length === 0 ? (
          <p className="text-[13px] text-muted">No directives in force.</p>
        ) : (
          <div className="space-y-2">
            {directives.map((l) => {
              const def = getDirectiveDef(l.directiveKey);
              const turnsLeft =
                currentTurn != null && l.directiveExpiresOnTurn != null
                  ? Math.max(0, l.directiveExpiresOnTurn - currentTurn)
                  : null;
              return (
                <div
                  key={l._id.toString()}
                  className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted p-3"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-foreground">
                      {def?.label ?? l.title}
                    </div>
                    {def?.blurb && <div className="text-[11px] text-muted">{def.blurb}</div>}
                  </div>
                  {turnsLeft != null && (
                    <span className="shrink-0 text-[11px] text-muted">
                      Lifts in {turnsLeft} turn{turnsLeft === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Free-trade agreements" sub="Active intra-bloc tariff-free pacts">
        {activeFtas.length === 0 ? (
          <p className="text-[13px] text-muted">No active free-trade agreements.</p>
        ) : (
          <div className="space-y-2">
            {activeFtas.map((l) => {
              const parties = (l.parties ?? [])
                .map((p) => COUNTRY_CONFIGS[p as CountryId]?.name ?? p)
                .join(", ");
              return (
                <div
                  key={l._id.toString()}
                  className="rounded-lg border border-card-border bg-card-muted p-3"
                >
                  <div className="text-[12px] font-semibold text-foreground">{l.title}</div>
                  {parties && <div className="text-[11px] text-muted">{parties}</div>}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function DevelopmentFlagship({ org }: { org: OrgSummary }) {
  const disbursed = org.activeLegislation.filter((l) => l.type === "aid_package");
  const pending = org.pendingLegislation.filter((l) => l.type === "aid_package");
  // Balance native; the disbursement amounts below are a record and convert.
  const fundAmount = useFundFormatter(org.fund);
  const fundDisplay = formatFundAmount(org.fund.balanceLocal, org.fund.currencyCode);
  const name = (c?: CountryId) => (c ? (COUNTRY_CONFIGS[c]?.name ?? c) : "—");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Members" value={`${org.members.length}`} sub="states" accent />
        <MetricTile label="Fund" value={fundDisplay} sub={`pooled, ${org.fund.currencyCode}`} />
        <MetricTile label="Projects" value={`${disbursed.length}`} sub="disbursed" />
        <MetricTile label="Pending aid" value={`${pending.length}`} sub="awaiting a vote" />
      </div>

      <Section
        title="Financed projects"
        sub="Aid packages disbursed from the pooled fund (each gave its recipient a growth boost)"
      >
        {disbursed.length === 0 ? (
          <p className="text-[13px] text-muted">No aid disbursed yet.</p>
        ) : (
          <div className="space-y-2">
            {disbursed.map((l) => (
              <div
                key={l._id.toString()}
                className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted p-3"
              >
                <div className="text-[12px] font-semibold text-foreground">
                  {name(l.aidRecipientCountryId)}
                </div>
                <div className="text-[12px] tabular-nums text-foreground">
                  {l.aidAmount ? fundAmount(l.aidAmount) : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">
          Table new aid packages and set dues from the Overview tab.
        </p>
      </Section>
    </div>
  );
}

export function FlagshipTab({ org, currentTurn }: { org: OrgSummary; currentTurn?: number }) {
  const template = ORGANIZATION_CATEGORY_META[org.def.category].flagship;
  return (
    <div className="space-y-4">
      <CharterPowers org={org} />
      {template === "assembly" && <PoliticalAssembly org={org} currentTurn={currentTurn} />}
      {template === "alliance" && <SecurityAlliance org={org} />}
      {template === "market" && <EconomicMarket org={org} currentTurn={currentTurn} />}
      {template === "development" && <DevelopmentFlagship org={org} />}
    </div>
  );
}
