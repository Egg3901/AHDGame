import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import type { ReferendumStatus } from "@/lib/db/types/referendum";
import type { PollPoint } from "@/lib/referendum/pollSnapshot";
import { referendumDetailUrl } from "@/lib/urls";
import { computeReferendumMomentum } from "@/lib/referendum/momentum";
import { CampaignStatusPill } from "./CampaignStatusPill";
import { TugOfWar } from "./TugOfWar";
import { MomentumIndicator } from "./MomentumIndicator";

/** One live campaign row, shared by all three hub layouts. */
export interface HubCampaign {
  regionId: string;
  regionName: string;
  kind: "independence" | "reunification";
  status: ReferendumStatus;
  yesShare: number;
  pollHistory: PollPoint[];
  positionCounts: { for: number; against: number; undeclared: number };
  /** Turns until the vote, or null if not known/closed. */
  closeInTurns: number | null;
}

export function kindLabel(kind: HubCampaign["kind"]): string {
  return kind === "reunification" ? "Reunification referendum" : "Independence referendum";
}

/** Turns-to-vote → "Vote in N turns" / "—". */
export function closeInLabel(closeInTurns: number | null): string {
  if (closeInTurns == null || closeInTurns <= 0) return "—";
  return `Vote in ${closeInTurns} ${closeInTurns === 1 ? "turn" : "turns"}`;
}

/** Cards layout: a rich grid of campaign cards. Party blocs are Sub-project D. */
export function HubCards({
  countryId,
  campaigns,
}: {
  countryId: string;
  campaigns: HubCampaign[];
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-[18px]">
      {campaigns.map((c) => (
        <Link
          key={c.regionId}
          href={referendumDetailUrl(countryId, c.regionId)}
          className="relative block overflow-hidden rounded-2xl border border-card-border bg-card shadow-card transition-transform hover:-translate-y-0.5"
        >
          <div className="h-[5px] bg-[var(--ref-amber)]" />
          <div className="px-5 pb-5 pt-[18px]">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-[42px] w-[42px] flex-none items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-[var(--ref-amber)] bg-background/40">
                <CountryFlag country={countryId} size="md" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-extrabold leading-tight tracking-tight">
                  {c.regionName}
                </div>
                <div className="mt-0.5 text-[11.5px] font-semibold text-muted">
                  {kindLabel(c.kind)}
                </div>
              </div>
              <CampaignStatusPill status={c.status} />
            </div>

            <TugOfWar yesShare={c.yesShare} showThreshold />

            <div className="mt-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MomentumIndicator momentum={computeReferendumMomentum(c.pollHistory)} />
              </span>
              <span className="text-[11.5px] font-semibold text-muted">
                {closeInLabel(c.closeInTurns)}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-muted">
              <span className="text-[var(--ref-yes)]">● {c.positionCounts.for} For</span>
              <span className="text-[var(--ref-no)]">● {c.positionCounts.against} Against</span>
              <span>· {c.positionCounts.undeclared} undeclared</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
