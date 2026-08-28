"use client";

import { Badge } from "@/components/ui";
import type { CountryId } from "@/lib/constants/countries";
import { canTableResolutionType } from "@/lib/constants/orgCategory";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { LeadershipPanel } from "../LeadershipPanel";
import { MembershipPanel } from "../MembershipPanel";
import { LegislationPanel } from "../LegislationPanel";
import { SanctionsPanel } from "./SanctionsPanel";
import { AidPanel } from "./AidPanel";
import { DirectivePanel } from "./DirectivePanel";
import { JointStatementPanel } from "./JointStatementPanel";
import { PosturePanel } from "./PosturePanel";
import { JoinConflictPanel } from "./JoinConflictPanel";
import { AgencyFundingPanel } from "./AgencyFundingPanel";
import { FundOrgPanel } from "./FundOrgPanel";
import { DuesPanel } from "./DuesPanel";
import { Ring, Meter } from "./OrgPrimitives";
import { WarEntryStatusPanel } from "./WarEntryStatusPanel";

function viewerCountry(viewer: OrgViewerInfo | null): CountryId | null {
  return viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
}

/** Delegation standing card — the viewer's seat in this org. */
function DelegationPanel({ org, viewer }: { org: OrgSummary; viewer: OrgViewerInfo | null }) {
  const you = viewerCountry(viewer);
  const membership = you ? org.members.find((m) => m.countryId === you) : undefined;
  const influence = you
    ? (org.derived.members.find((m) => m.countryId === you)?.influenceIndex ?? 0)
    : 0;
  const contribution = you
    ? (org.derived.members.find((m) => m.countryId === you)?.contributionPct ?? 0)
    : 0;

  if (!you) {
    return (
      <div
        className="rounded-xl border bg-card p-4 sm:p-5"
        style={{ borderColor: "color-mix(in srgb, var(--org) 26%, transparent)" }}
      >
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
          Your delegation
        </div>
        <p className="mt-1 text-sm text-muted">
          You hold no foreign-affairs role. Diplomatic actions are available to a country&apos;s
          foreign minister (or head of government).
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border bg-card p-4 sm:p-5"
      style={{ borderColor: "color-mix(in srgb, var(--org) 26%, transparent)" }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-4xl">{membership?.flagEmoji ?? "🏳️"}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            Your delegation · {membership?.countryName ?? you}
          </div>
          <div className="mt-0.5 text-lg font-bold text-foreground">
            {membership
              ? membership.status === "founding"
                ? "Founding member"
                : "Member"
              : "Non-member"}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge color="info" variant="subtle">
              {(contribution * 100).toFixed(contribution < 0.01 ? 1 : 0)}% contribution
            </Badge>
            {membership && (
              <Badge color="success" variant="subtle">
                Seat active
              </Badge>
            )}
          </div>
        </div>
        <Ring value={influence} size={62} label="influence" />
      </div>
    </div>
  );
}

/** Members & standing table. */
function MemberTable({ org }: { org: OrgSummary }) {
  const influenceByCountry = new Map<string, (typeof org.derived.members)[number]>(
    org.derived.members.map((m) => [m.countryId, m] as const)
  );
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 text-sm font-semibold text-foreground">
        Members &amp; standing
        <span className="ml-2 text-[11px] font-normal text-muted">
          {org.members.length} members · contributions &amp; influence
        </span>
      </div>
      {org.members.length === 0 ? (
        <p className="text-[13px] text-muted">No member states yet.</p>
      ) : (
        <div className="space-y-1.5">
          {org.members.map((m) => {
            const d = influenceByCountry.get(m.countryId);
            return (
              <div
                key={m.countryId}
                className="flex items-center gap-3 rounded-lg border border-card-border bg-card-muted px-3 py-2"
              >
                <span className="text-lg">{m.flagEmoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-foreground">
                    {m.countryName}
                  </div>
                  <div className="text-[11px] text-muted">
                    {m.status === "founding" ? "Founding" : "Member"}
                  </div>
                </div>
                <div className="hidden w-24 shrink-0 sm:block">
                  <div className="text-[10px] text-muted">Influence</div>
                  <Meter value={d?.influenceIndex ?? 0} height={5} />
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px] font-semibold tabular-nums text-foreground">
                    {((d?.contributionPct ?? 0) * 100).toFixed(
                      (d?.contributionPct ?? 0) < 0.01 ? 1 : 0
                    )}
                    %
                  </div>
                  <div className="text-[10px] text-muted">contribution</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OverviewTab({
  org,
  viewer,
  currentTurn,
  votingWindowTurns,
  onChange,
}: {
  org: OrgSummary;
  viewer: OrgViewerInfo | null;
  currentTurn: number;
  votingWindowTurns: number;
  onChange: () => void;
}) {
  return (
    <div className="space-y-4">
      <DelegationPanel org={org} viewer={viewer} />
      <WarEntryStatusPanel org={org} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <MemberTable org={org} />
        </div>
        <div className="lg:col-span-2">
          <MembershipPanel
            org={org}
            viewer={viewer}
            currentTurn={currentTurn}
            votingWindowTurns={votingWindowTurns}
            onChange={onChange}
          />
        </div>
      </div>

      {/* Resolutions & elected leadership — proven action surfaces. */}
      {canTableResolutionType(org.def.category, "free_trade_agreement") && (
        <LegislationPanel
          org={org}
          viewer={viewer}
          currentTurn={currentTurn}
          votingWindowTurns={votingWindowTurns}
          onChange={onChange}
        />
      )}
      {canTableResolutionType(org.def.category, "sanctions") && (
        <SanctionsPanel
          org={org}
          viewer={viewer}
          currentTurn={currentTurn}
          votingWindowTurns={votingWindowTurns}
          onChange={onChange}
        />
      )}
      {canTableResolutionType(org.def.category, "aid_package") && (
        <AidPanel
          org={org}
          viewer={viewer}
          currentTurn={currentTurn}
          votingWindowTurns={votingWindowTurns}
          onChange={onChange}
        />
      )}
      {canTableResolutionType(org.def.category, "directive") && (
        <DirectivePanel
          org={org}
          viewer={viewer}
          currentTurn={currentTurn}
          votingWindowTurns={votingWindowTurns}
          onChange={onChange}
        />
      )}
      {canTableResolutionType(org.def.category, "joint_statement") && (
        <JointStatementPanel
          org={org}
          viewer={viewer}
          currentTurn={currentTurn}
          votingWindowTurns={votingWindowTurns}
          onChange={onChange}
        />
      )}
      {canTableResolutionType(org.def.category, "set_posture") && (
        <PosturePanel
          org={org}
          viewer={viewer}
          currentTurn={currentTurn}
          votingWindowTurns={votingWindowTurns}
          onChange={onChange}
        />
      )}
      {/* Bloc-only, and the panel gates on the same predicate internally so it is
          safe wherever it is mounted. */}
      {canTableResolutionType(org.def.category, "join_conflict") && (
        <JoinConflictPanel
          org={org}
          viewer={viewer}
          currentTurn={currentTurn}
          votingWindowTurns={votingWindowTurns}
          onChange={onChange}
        />
      )}
      {canTableResolutionType(org.def.category, "fund_agency") && (
        <AgencyFundingPanel
          org={org}
          viewer={viewer}
          currentTurn={currentTurn}
          votingWindowTurns={votingWindowTurns}
          onChange={onChange}
        />
      )}
      <FundOrgPanel org={org} viewer={viewer} onChange={onChange} />
      <DuesPanel
        org={org}
        viewer={viewer}
        currentTurn={currentTurn}
        votingWindowTurns={votingWindowTurns}
        onChange={onChange}
      />
      <LeadershipPanel
        org={org}
        viewer={viewer}
        currentTurn={currentTurn}
        votingWindowTurns={votingWindowTurns}
        onChange={onChange}
      />

      {org.def.charter && (
        <div className="rounded-xl border border-card-border bg-card p-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            Charter
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{org.def.charter}</p>
        </div>
      )}
    </div>
  );
}
