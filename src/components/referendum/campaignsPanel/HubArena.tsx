import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import { referendumDetailUrl } from "@/lib/urls";
import { computeReferendumMomentum } from "@/lib/referendum/momentum";
import { CampaignStatusPill } from "./CampaignStatusPill";
import { MomentumIndicator } from "./MomentumIndicator";
import { type HubCampaign, kindLabel, closeInLabel } from "./HubCards";

/** Arena layout: a full-width Yes/No split bar per campaign with large numerals. */
export function HubArena({
  countryId,
  campaigns,
}: {
  countryId: string;
  campaigns: HubCampaign[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {campaigns.map((c) => {
        const yes = Math.max(0, Math.min(100, c.yesShare));
        const no = 100 - Math.round(yes);
        return (
          <Link
            key={c.regionId}
            href={referendumDetailUrl(countryId, c.regionId)}
            className="block rounded-2xl border border-card-border bg-card p-5 shadow-card transition-shadow hover:shadow-modal"
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-[34px] w-[34px] flex-none items-center justify-center overflow-hidden rounded-full">
                <CountryFlag country={countryId} size="md" />
              </div>
              <div className="text-lg font-extrabold tracking-tight">{c.regionName}</div>
              <div className="text-[12px] font-semibold text-muted">· {kindLabel(c.kind)}</div>
              <div className="ml-auto">
                <CampaignStatusPill status={c.status} />
              </div>
              <div className="text-[12px] font-semibold text-muted">
                {closeInLabel(c.closeInTurns)}
              </div>
            </div>
            <div className="flex h-[62px] items-stretch overflow-hidden rounded-xl border border-card-border">
              <div
                className="flex min-w-[64px] flex-col justify-center bg-[var(--ref-yes)] px-[18px] text-white transition-[width] duration-500"
                style={{ width: `${yes}%` }}
              >
                <div className="text-[9.5px] font-bold uppercase tracking-wider opacity-90">
                  Yes
                </div>
                <div className="font-mono text-[23px] font-black leading-none">
                  {Math.round(yes)}%
                </div>
              </div>
              <div className="flex min-w-[64px] flex-1 flex-col items-end justify-center bg-[var(--ref-no)] px-[18px] text-white">
                <div className="text-[9.5px] font-bold uppercase tracking-wider opacity-90">No</div>
                <div className="font-mono text-[23px] font-black leading-none">{no}%</div>
              </div>
            </div>
            <div className="mt-3 text-center">
              <MomentumIndicator momentum={computeReferendumMomentum(c.pollHistory)} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
