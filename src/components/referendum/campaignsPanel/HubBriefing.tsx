import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import { referendumDetailUrl } from "@/lib/urls";
import { computeReferendumMomentum } from "@/lib/referendum/momentum";
import { CampaignStatusPill } from "./CampaignStatusPill";
import { Sparkline } from "./Sparkline";
import { MomentumIndicator } from "./MomentumIndicator";
import { type HubCampaign, kindLabel } from "./HubCards";

const COLS = "grid-cols-[1.6fr_.9fr_.8fr_.8fr_.9fr]";

/**
 * Briefing layout: a dense table. The Trend column renders the poll-history
 * sparkline and Momentum the recent-swing indicator; both fall back to a
 * neutral baseline / "—" until a campaign has accrued two or more readings.
 */
export function HubBriefing({
  countryId,
  campaigns,
}: {
  countryId: string;
  campaigns: HubCampaign[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
      <div
        className={`grid ${COLS} gap-3.5 border-b border-card-border bg-background/40 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-muted`}
      >
        <div>Nation / Question</div>
        <div>Trend (recent)</div>
        <div>Standing</div>
        <div>Momentum</div>
        <div>Status</div>
      </div>
      {campaigns.map((c) => {
        const yes = Math.round(Math.max(0, Math.min(100, c.yesShare)));
        return (
          <Link
            key={c.regionId}
            href={referendumDetailUrl(countryId, c.regionId)}
            className={`grid ${COLS} items-center gap-3.5 border-b border-card-border px-5 py-4 transition-colors hover:bg-card-elevated`}
          >
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 flex-none overflow-hidden rounded-full">
                <CountryFlag country={countryId} size="sm" />
              </div>
              <div>
                <div className="text-[14.5px] font-bold tracking-tight">{c.regionName}</div>
                <div className="mt-0.5 text-[11px] text-muted">{kindLabel(c.kind)}</div>
              </div>
            </div>
            <div className="h-[34px]">
              <Sparkline history={c.pollHistory} />
            </div>
            <div className="font-mono">
              <span className="text-base font-extrabold text-[var(--ref-yes)]">{yes}%</span>{" "}
              <span className="text-[11px] text-muted">Yes</span>
            </div>
            <div>
              <MomentumIndicator momentum={computeReferendumMomentum(c.pollHistory)} />
            </div>
            <div>
              <CampaignStatusPill status={c.status} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
