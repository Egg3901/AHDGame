import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/currentTurn";
import { listCountryReferendums } from "@/lib/referendum/referendumCycles";
import { referendumDetailUrl } from "@/lib/urls";
import { ReferendumMasthead } from "@/components/referendum/campaignsPanel/ReferendumMasthead";
import {
  HubLayoutSwitcher,
  type HubLayout,
} from "@/components/referendum/campaignsPanel/HubLayoutSwitcher";
import { HubCards, type HubCampaign } from "@/components/referendum/campaignsPanel/HubCards";
import { HubArena } from "@/components/referendum/campaignsPanel/HubArena";
import { HubBriefing } from "@/components/referendum/campaignsPanel/HubBriefing";
import { CampaignStatusPill } from "@/components/referendum/campaignsPanel/CampaignStatusPill";

const LAYOUTS: HubLayout[] = ["cards", "arena", "briefing"];

export default async function ReferendumsIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ layout?: string }>;
}) {
  const { code } = await params;
  const { layout: layoutParam } = await searchParams;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();
  const layout: HubLayout = LAYOUTS.includes(layoutParam as HubLayout)
    ? (layoutParam as HubLayout)
    : "cards";

  const db = await getDb();
  const [{ active, past }, currentTurn] = await Promise.all([
    listCountryReferendums(db, countryId),
    getCurrentTurn(db),
  ]);

  // Region display names for every listed row.
  const regionIds = [...new Set([...active, ...past].map((r) => r.regionId))];
  const states = regionIds.length
    ? await db
        .collection<State>("states")
        .find({ _id: { $in: regionIds }, countryId })
        .toArray()
    : [];
  const nameById = new Map(states.map((s) => [s._id, s.name]));
  const regionName = (id: string) => nameById.get(id) ?? id;

  const campaigns: HubCampaign[] = active.map((r) => ({
    regionId: r.regionId,
    regionName: regionName(r.regionId),
    kind: r.kind,
    status: r.status,
    yesShare: r.yesShare,
    pollHistory: r.pollHistory,
    positionCounts: r.positionCounts,
    closeInTurns: r.campaignCloseTurn != null ? r.campaignCloseTurn - currentTurn : null,
  }));

  return (
    <div className="mx-auto max-w-[1280px] px-7 pb-20 pt-6">
      <ReferendumMasthead
        countryId={countryId}
        emblemCountry={countryId}
        registry="Referendums"
        title={getCountryConfig(countryId).name}
        subtitle={`${active.length} live · ${past.length} concluded`}
        tiles={[
          {
            label: "Live campaigns",
            value: String(active.length),
            tone: active.length ? "amber" : "fg",
          },
          { label: "Concluded", value: String(past.length) },
          { label: "Regions", value: String(regionIds.length) },
        ]}
      />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs font-bold uppercase tracking-wider text-muted">
          Live campaigns · choose a view
        </div>
        <HubLayoutSwitcher active={layout} />
      </div>

      {campaigns.length > 0 ? (
        layout === "arena" ? (
          <HubArena countryId={countryId} campaigns={campaigns} />
        ) : layout === "briefing" ? (
          <HubBriefing countryId={countryId} campaigns={campaigns} />
        ) : (
          <HubCards countryId={countryId} campaigns={campaigns} />
        )
      ) : (
        <div className="rounded-2xl border border-card-border bg-card px-6 py-10 text-center text-sm text-muted">
          No referendum campaigns are under way.
        </div>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
          Past referendums
        </h2>
        {past.length > 0 ? (
          <ul className="space-y-2">
            {past
              .slice()
              .reverse()
              .map((r) => (
                <li key={r.referendumId}>
                  <Link
                    href={referendumDetailUrl(countryId, r.regionId, r.cycle)}
                    className="flex items-center justify-between rounded-xl border border-card-border bg-card px-4 py-3 hover:border-primary/50"
                  >
                    <span className="text-sm font-medium">
                      {regionName(r.regionId)} —{" "}
                      {r.kind === "reunification" ? "Reunification" : "Independence"}{" "}
                      <span className="text-xs text-muted">· cycle {r.cycle}</span>
                    </span>
                    <CampaignStatusPill status={r.status} />
                  </Link>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No past referendums.</p>
        )}
      </section>
    </div>
  );
}
