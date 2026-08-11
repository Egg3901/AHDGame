import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { Bill, PoliticalParty, State, StatePartyOrg } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/currentTurn";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { canSpendOnStateParty, canDeclarePartyPosition } from "@/lib/parties/access";
import { resolveRegionReferendumByCycle } from "@/lib/referendum/referendumCycles";
import { referendumsUrl, referendumDetailUrl } from "@/lib/urls";
import type { Referendum } from "@/lib/db/types/referendum";
import { ReferendumMasthead } from "@/components/referendum/campaignsPanel/ReferendumMasthead";
import { statusMeta } from "@/components/referendum/campaignsPanel/CampaignStatusPill";
import { TugOfWar } from "@/components/referendum/campaignsPanel/TugOfWar";
import { CampaignRail } from "@/components/referendum/campaignsPanel/CampaignRail";
import { TrackingPoll } from "@/components/referendum/campaignsPanel/TrackingPoll";
import { MomentumIndicator } from "@/components/referendum/campaignsPanel/MomentumIndicator";
import { computeReferendumMomentum } from "@/lib/referendum/momentum";
import { PartyPositions } from "@/components/referendum/campaignsPanel/PartyPositions";
import type { PartyLite } from "@/components/referendum/campaignsPanel/PartyChip";
import {
  CohortBreakdown,
  type CohortRow,
} from "@/components/referendum/campaignsPanel/CohortBreakdown";
import { leanFromUnits, effLean, effTurnout } from "@/lib/referendum/cohortEngine";
import { referendumSideLabels } from "@/lib/referendum/sideLabels";
import { ViewingAsControl } from "@/components/referendum/campaignsPanel/ViewingAsControl";
import { GG_TURNOUT_MOD_CAP, GG_LEAN_MOD_CAP } from "@/lib/constants/referendum";
import { listReferendumWire } from "@/lib/referendum/wire";
import { CampaignWire } from "@/components/referendum/campaignsPanel/CampaignWire";
import { ConsentBillStatus } from "@/components/referendum/campaignsPanel/ConsentBillStatus";
import { buildConsentBillViews, type ConsentBillView } from "@/lib/referendum/consentBillView";
import type { ObjectId } from "mongodb";

/** Humanize a cohort group id for display ("urban_progressives" → "Urban progressives"). */
function cohortName(groupId: string): string {
  if (groupId === "_all") return "All voters";
  const s = groupId.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Turnout-weighted average of cohort effective turnouts (null when no cohorts). */
function weightedTurnout(cohorts: { share: number; turnout: number }[]): number | null {
  const den = cohorts.reduce((s, c) => s + c.share, 0);
  if (den === 0) return null;
  return cohorts.reduce((s, c) => s + c.share * c.turnout, 0) / den;
}

/** Plain-language summary of a non-campaigning referendum's state. */
function statusSummary(ref: Referendum, region: string): string {
  const yes = ref.result ? `${Math.round(ref.result.finalYesShare)}% Yes` : null;
  switch (ref.status) {
    case "completed":
      return ref.kind === "reunification"
        ? `${region} left the United Kingdom and reunified with Ireland.`
        : `${region} became an independent country.`;
    case "settled":
      return `Defeated at the ballot box${yes ? ` — ${yes}` : ""}. The question is settled for now.`;
    case "declined":
      return "Declined by the Prime Minister.";
    case "cancelled":
      return "The conversion was blocked — the region did not transfer.";
    case "requested":
      return "Awaiting the Prime Minister's decision to grant the referendum.";
    case "granted":
      return "Granted — the campaign is opening.";
    case "polling":
      return "The ballots are being counted.";
    case "actuating":
      return "Carried at the ballot box — the conversion is under way.";
    default:
      return "";
  }
}

export default async function ReferendumDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; regionId: string }>;
  searchParams: Promise<{ cycle?: string; wire?: string; target?: string; as?: string }>;
}) {
  const { code, regionId } = await params;
  const {
    cycle: cycleParam,
    wire: wireParam,
    target: targetParam,
    as: asParam,
  } = await searchParams;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();

  const db = await getDb();
  const cycle = cycleParam != null ? Number(cycleParam) : undefined;
  const resolved = await resolveRegionReferendumByCycle(
    db,
    countryId,
    regionId,
    Number.isFinite(cycle) ? cycle : undefined
  );
  if (!resolved) notFound();

  const ref = resolved.referendum;
  const [currentTurn, stateDoc, user, pmId] = await Promise.all([
    getCurrentTurn(db),
    db.collection<State>("states").findOne({ _id: regionId.toUpperCase(), countryId }),
    getAuthUserWithCharacter(),
    getHeadOfGovernmentCharacterId(db, countryId),
  ]);
  const regionName = stateDoc?.name ?? regionId.toUpperCase();
  const noun = ref.kind === "reunification" ? "Reunification" : "Independence";
  const labels = referendumSideLabels(ref.kind);
  const isAdmin = user?.isAdmin === true;
  const isPM = pmId != null && user?.character?._id != null && pmId.equals(user.character._id);
  // Admin "Viewing as" role (from ?as=); non-admins always see their real role.
  const role =
    isAdmin && ["pm", "leader", "player", "spectator"].includes(asParam ?? "")
      ? (asParam as "pm" | "leader" | "player" | "spectator")
      : "auto";

  // Org-present parties in the region = the "could declare / undeclared" set.
  const regionStateParties = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId, stateId: regionId.toUpperCase() })
    .toArray();
  const orgPartyIds = regionStateParties.map((sp) => String(sp.partyId));
  const partyDocs = orgPartyIds.length
    ? await db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId, sequentialId: { $in: orgPartyIds.map(Number) } })
        .toArray()
    : [];
  const liteById = new Map<string, PartyLite>(
    partyDocs.map((p) => [
      String(p.sequentialId),
      {
        partyId: String(p.sequentialId),
        abbreviation: p.abbreviation,
        color: p.color,
        name: p.name,
      },
    ])
  );
  const sideByParty = new Map((ref.partyPositions ?? []).map((p) => [p.partyId, p.side]));
  const forParties: PartyLite[] = [];
  const againstParties: PartyLite[] = [];
  const undeclared: PartyLite[] = [];
  for (const id of orgPartyIds) {
    const lite = liteById.get(id);
    if (!lite) continue;
    const side = sideByParty.get(id);
    if (side === "yes") forParties.push(lite);
    else if (side === "no") againstParties.push(lite);
    else undeclared.push(lite);
  }
  // A party that declared but has since lost org presence still shows its stance.
  for (const pos of ref.partyPositions ?? []) {
    if (orgPartyIds.includes(pos.partyId)) continue;
    const lite = liteById.get(pos.partyId);
    if (lite) (pos.side === "yes" ? forParties : againstParties).push(lite);
  }

  // Viewer eligibility (only meaningful while campaigning). Resolve the viewer's
  // party + state-party once for both campaign spend and position declaration.
  let viewerIsPartyOfficer = false;
  let viewerCanDeclare = false;
  let viewerDeclaredSide: "yes" | "no" | null = null;
  if (ref.status === "campaigning" && user?.character?.party) {
    const viewerParty = String(user.character.party);
    const [viewerPartyDoc, viewerStateParty] = await Promise.all([
      db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ countryId, sequentialId: Number(viewerParty) }),
      db
        .collection<StatePartyOrg>("statePartyOrg")
        .findOne({ countryId, stateId: regionId.toUpperCase(), partyId: viewerParty }),
    ]);
    if (viewerPartyDoc) {
      viewerIsPartyOfficer = canSpendOnStateParty(viewerPartyDoc, viewerStateParty, user);
      viewerCanDeclare = canDeclarePartyPosition(viewerPartyDoc, viewerStateParty, user);
    }
    viewerDeclaredSide = (sideByParty.get(viewerParty) as "yes" | "no" | undefined) ?? null;
  }

  // Cohort breakdown (effective turnout/lean = baseline + ground-game mods + the
  // PS uniform lean shift) + the ground-game control's target list.
  const uniformLeanShift = leanFromUnits(
    ref.campaignSpendUnits?.yes ?? 0,
    ref.campaignSpendUnits?.no ?? 0
  );
  const modByGroup = new Map((ref.cohortModifiers ?? []).map((m) => [m.groupId, m]));
  const cohortRows: CohortRow[] = (ref.cohortBaseline ?? []).map((c) => {
    const m = modByGroup.get(c.groupId);
    return {
      groupId: c.groupId,
      name: cohortName(c.groupId),
      share: c.share,
      turnout: Math.max(0, Math.min(100, c.turnout + effTurnout(m?.turnoutMod ?? 0))),
      yesLean: Math.max(0, Math.min(100, c.yesLean + effLean(m?.leanMod ?? 0) + uniformLeanShift)),
    };
  });
  const cohorts = cohortRows.map((c) => ({ groupId: c.groupId, name: c.name }));
  // Any same-nation character may run ground game while campaigning (officials
  // pay PS, everyone else volunteers Actions + Funds). The admin "Viewing as"
  // preview overrides the mode: Party Leader → official, Player → volunteer,
  // Spectator → can't act; Auto/PM follow the viewer's real officer status.
  const viewerCanGroundGame =
    ref.status === "campaigning" &&
    cohorts.length > 0 &&
    user?.character?.countryId === ref.countryId &&
    role !== "spectator";
  const effectiveOfficer =
    role === "leader" ? true : role === "player" ? false : viewerIsPartyOfficer;
  const groundGameMode: "official" | "volunteer" = effectiveOfficer ? "official" : "volunteer";

  // Ground-game target (?target=groupId | whole) + its campaign saturation.
  const ggTarget: "whole" | { groupId: string } =
    targetParam && cohortRows.some((c) => c.groupId === targetParam)
      ? { groupId: targetParam }
      : "whole";
  const ggTargetName = ggTarget === "whole" ? "Whole electorate" : cohortName(targetParam!);
  const cohortSaturation = (groupId: string) => {
    const m = modByGroup.get(groupId);
    // Raw units → 0..1 fill via the same tanh the engine reads through.
    return Math.max(
      Math.abs(Math.tanh((m?.turnoutMod ?? 0) / GG_TURNOUT_MOD_CAP)),
      Math.abs(Math.tanh((m?.leanMod ?? 0) / GG_LEAN_MOD_CAP))
    );
  };
  const ggSaturation =
    ggTarget === "whole"
      ? cohortRows.length
        ? cohortRows.reduce((s, c) => s + cohortSaturation(c.groupId), 0) / cohortRows.length
        : 0
      : cohortSaturation(ggTarget.groupId);

  // Campaign wire (paginated 10/page via ?wire=N, preserving ?cycle).
  const wirePageParam = wireParam != null ? Number(wireParam) : 1;
  const wire = await listReferendumWire(
    db,
    ref._id as ObjectId,
    Number.isFinite(wirePageParam) ? wirePageParam : 1
  );
  // One href builder that preserves every active param and applies overrides
  // (used by the wire pager, the cohort tap-target, and the viewing-as control).
  const basePath = `/country/${countryId.toLowerCase()}/referendums/${regionId.toLowerCase()}`;
  const makeHref = (extra: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    if (cycleParam != null) sp.set("cycle", cycleParam);
    if (wireParam != null) sp.set("wire", wireParam);
    if (targetParam != null) sp.set("target", targetParam);
    if (asParam != null) sp.set("as", asParam);
    for (const [k, v] of Object.entries(extra)) {
      if (v == null) sp.delete(k);
      else sp.set(k, String(v));
    }
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const wireHref = (p: number) => makeHref({ wire: p });

  // Consent bill(s) for the conversion window — surfaced only while "actuating"
  // (carried at the ballot box, now awaiting Parliament's consent before the
  // region actually converts). Westminster always; the Dáil bill too on a NI
  // reunification. Ordered Westminster-first to match the campaign masthead.
  let consentBills: ConsentBillView[] = [];
  if (ref.status === "actuating") {
    const orderedBillIds = [ref.westminsterBillId, ref.dailBillId].filter(
      (x): x is ObjectId => x != null
    );
    if (orderedBillIds.length > 0) {
      const billDocs = await db
        .collection<Bill>("bills")
        .find({ _id: { $in: orderedBillIds } })
        .toArray();
      const byId = new Map(billDocs.map((b) => [String(b._id), b]));
      consentBills = buildConsentBillViews(orderedBillIds, byId);
    }
  }

  const emblemSeal = {
    line1: regionName.toUpperCase(),
    line2: ref.kind === "reunification" ? "BORDER POLL" : "INDEPENDENCE POLL",
  };

  const turnsToVote = ref.campaignCloseTurn != null ? ref.campaignCloseTurn - currentTurn : null;
  // Campaigning → time to the vote; otherwise the short status label (a full
  // sentence would overflow the stat tile).
  const voteTile =
    ref.status === "campaigning" && turnsToVote != null && turnsToVote > 0
      ? `${turnsToVote} turns`
      : statusMeta(ref.status).label;

  // Masthead tiles — the mockup's six while campaigning, all from data we hold.
  const momentum = computeReferendumMomentum(ref.pollHistory);
  const turnoutEst = weightedTurnout(cohortRows);
  const margin = Math.abs(ref.yesShare - 50);
  const leader = ref.yesShare >= 50 ? labels.yes : labels.no;
  const campaigningTiles: {
    label: string;
    value: string;
    sub?: string;
    tone?: "yes" | "no" | "amber";
  }[] = [
    { label: labels.yes, value: `${Math.round(ref.yesShare)}%`, tone: "yes" },
    { label: labels.no, value: `${Math.round(100 - ref.yesShare)}%`, tone: "no" },
    { label: "Margin", value: `±${margin.toFixed(1)} pts`, sub: `${leader} ahead` },
    {
      label: "Momentum",
      value: momentum
        ? `${momentum.recentDelta >= 0 ? "+" : ""}${momentum.recentDelta.toFixed(1)}`
        : "—",
      tone: "amber",
    },
    ...(turnoutEst != null ? [{ label: "Turnout est.", value: `${Math.round(turnoutEst)}%` }] : []),
    ...(ref.campaignCloseTurn != null
      ? [{ label: "Polling day", value: `Turn ${ref.campaignCloseTurn}` }]
      : []),
  ];
  const terminalTiles = [
    { label: labels.yes, value: `${Math.round(ref.yesShare)}%`, tone: "yes" as const },
    { label: "Threshold", value: "50.0%" },
    { label: "Vote", value: voteTile },
    { label: "Cycle", value: `${resolved.cycle} of ${resolved.totalCycles}` },
  ];

  const prevHref =
    resolved.prevCycle != null
      ? referendumDetailUrl(countryId, regionId, resolved.prevCycle)
      : null;
  const nextHref =
    resolved.nextCycle != null
      ? referendumDetailUrl(countryId, regionId, resolved.nextCycle)
      : null;
  const navBtn = "rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm";

  return (
    <div className="mx-auto max-w-[1280px] px-7 pb-20 pt-6">
      <nav className="mb-3 flex items-center gap-2 text-[11.5px]">
        <Link href={referendumsUrl(countryId)} className="text-muted hover:text-foreground">
          Referendums
        </Link>
        <span className="text-card-border">/</span>
        <span className="font-semibold">
          {regionName} · {noun}
        </span>
      </nav>

      <ReferendumMasthead
        countryId={countryId}
        emblemCountry={countryId}
        emblemSplit={
          ref.kind === "reunification" && ref.targetCountryId
            ? { topLeft: ref.targetCountryId, bottomRight: ref.countryId }
            : ref.kind === "independence"
              ? // Independence: the seceding nation's flag over the UK's, mirroring
                // the reunification split (the emerging entity ▸ the union it leaves).
                { topLeft: ref.regionId, bottomRight: ref.countryId }
              : undefined
        }
        registry={`${getCountryConfig(countryId).name} · ${regionName}`}
        title={regionName}
        subtitle={`${noun} referendum`}
        statusPill={ref.status}
        tiles={ref.status === "campaigning" ? campaigningTiles : terminalTiles}
        accent={ref.status === "campaigning" ? "yes" : "neutral"}
        emblemSeal={emblemSeal}
        watermark={regionId.toUpperCase()}
        viewingAs={
          isAdmin ? (
            <ViewingAsControl active={role} hrefFor={(r) => makeHref({ as: r })} />
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center gap-2">
        {prevHref ? (
          <Link href={prevHref} className={`${navBtn} text-muted hover:text-foreground`}>
            ‹ Previous
          </Link>
        ) : (
          <span className={`${navBtn} cursor-not-allowed text-muted/40`}>‹ Previous</span>
        )}
        {nextHref ? (
          <Link href={nextHref} className={`${navBtn} text-muted hover:text-foreground`}>
            Next ›
          </Link>
        ) : (
          <span className={`${navBtn} cursor-not-allowed text-muted/40`}>Next ›</span>
        )}
        <span className="ml-2 text-xs text-muted">
          Referendum {resolved.cycle} of {resolved.totalCycles}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.55fr_1fr] lg:items-start">
        {/* LEFT — hero + tracking poll, then the cohort bars + wire (so the
            right rail sits beside "Where the votes are", matching the design). */}
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
            {ref.status === "campaigning" ? (
              <>
                <TugOfWar
                  yesShare={ref.yesShare}
                  size="hero"
                  showThreshold
                  yesLabel={labels.yes}
                  noLabel={labels.no}
                />
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    Campaign under way.
                    {ref.campaignCloseTurn != null &&
                      ` The vote is held on turn ${ref.campaignCloseTurn}${
                        turnsToVote != null && turnsToVote > 0 ? ` (in ${turnsToVote} turns)` : ""
                      }.`}
                  </p>
                  <MomentumIndicator momentum={computeReferendumMomentum(ref.pollHistory)} />
                </div>
                <div className="mt-5">
                  <TrackingPoll history={ref.pollHistory ?? []} />
                </div>
              </>
            ) : (
              <>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted">
                  Result
                </h2>
                <p className="text-sm text-foreground">{statusSummary(ref, regionName)}</p>
                {ref.result && (
                  <p className="mt-2 text-xs text-muted">
                    Final: {Math.round(ref.result.finalYesShare)}% Yes · turnout{" "}
                    {Math.round(ref.result.turnout)}% · resolved turn {ref.result.resolvedTurn}
                  </p>
                )}
                <div className="mt-5">
                  <TrackingPoll history={ref.pollHistory ?? []} />
                </div>
              </>
            )}
          </div>

          {consentBills.length > 0 && (
            <ConsentBillStatus
              kind={ref.kind}
              bills={consentBills}
              deadlineTurn={ref.conversionDeadlineTurn}
              currentTurn={currentTurn}
            />
          )}

          <CohortBreakdown
            rows={cohortRows}
            labels={labels}
            yesShare={ref.yesShare}
            targetHref={viewerCanGroundGame ? (t) => makeHref({ target: t }) : undefined}
            activeTarget={ggTarget === "whole" ? "whole" : ggTarget.groupId}
          />

          <CampaignWire
            events={wire.events.map((e) => ({
              turn: e.turn,
              kind: e.kind,
              side: e.side,
              delta: e.delta,
              summary: e.summary,
            }))}
            page={wire.page}
            totalPages={wire.totalPages}
            pageHref={wireHref}
            labels={labels}
          />
        </div>

        {/* RIGHT — party positions + the auto-derived action rail. */}
        <div className="flex flex-col gap-5">
          <PartyPositions
            forParties={forParties}
            againstParties={againstParties}
            undeclared={undeclared}
            labels={labels}
          />
          <CampaignRail
            countryId={countryId}
            regionId={ref.regionId}
            referendumId={String(ref._id)}
            status={ref.status}
            kind={ref.kind}
            yesShare={ref.yesShare}
            campaignCloseTurn={ref.campaignCloseTurn}
            currentTurn={currentTurn}
            isPM={isPM}
            isAdmin={isAdmin}
            role={role}
            viewerCanDeclare={viewerCanDeclare}
            viewerDeclaredSide={viewerDeclaredSide}
            viewerCanGroundGame={viewerCanGroundGame}
            groundGameMode={groundGameMode}
            groundGameTarget={ggTarget}
            groundGameTargetName={ggTargetName}
            groundGameSaturation={ggSaturation}
            groundGameLabels={labels}
          />
        </div>
      </div>
    </div>
  );
}
