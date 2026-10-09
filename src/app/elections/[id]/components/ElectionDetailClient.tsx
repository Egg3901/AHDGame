"use client";

import { BgFoundingConstituencyPicker } from "./BgFoundingConstituencyPicker";
import { Hu1991ConstituencyPicker } from "./Hu1991ConstituencyPicker";
import Link from "next/link";
import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/contexts/ToastContext";
import { resolveElectionYear } from "@/lib/utils/formatters";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { DEFAULT_CYCLE_ANCHOR_CONTEXT } from "@/lib/elections/cycleAnchorContext";
import { ElectionNavigation } from "./ElectionNavigation";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "@/lib/countries/jp/data/jpShugiinConstituencies1994";
import { ElectionHeader } from "./ElectionHeader";
import { AdminSection } from "./AdminSection";
import { ElectionScheduleCard } from "./ElectionScheduleCard";
import { PrimaryPhaseNote } from "./PrimaryPhaseNote";
import { UpcomingElectionView } from "./UpcomingElectionView";
import { GeneralPhaseView } from "./GeneralPhaseView";
import { PrimaryPhaseView } from "./PrimaryPhaseView";
import { PrimaryMapPills } from "./PrimaryMapPills";
import { CampaignsListPanel } from "./CampaignsListPanel";
import { CampaignManagerTab } from "./CampaignManagerTab";
import { ElectionDetailSkeleton } from "./ElectionDetailSkeleton";
import { StateOrganizationTab } from "@/app/political-operations/components/StateOrganizationTab";
import type { ElectionDetail } from "./ElectionDetailTypes";
import BackButton from "@/components/BackButton";
import { PrimaryBlendView } from "../blend/PrimaryBlendView";
import { GeneralBlendView } from "../blend/GeneralBlendView";
import { presidentialTitle } from "../blend/PresidentialStage";
import { presidentialResultsLive } from "../blend/liveState";
import { ResultsBlendView } from "../blend/ResultsBlendView";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { BLEND } from "@/components/blend/tokens";
import { NightBroadcast } from "../night/NightBroadcast";
import { useNightWatch } from "../night/useNightBroadcast";
import { isNightWindow } from "../night/nightModel";
import { buildWithdrawalConfirmMessage } from "@/lib/elections/withdrawalWarning";
import { captureProductEvent } from "@/lib/analytics/capture";
import { getStoredConsent } from "@/components/CookieConsent";
import { huDistrictIds } from "@/lib/countries/hu/rules/constituencies2014";
import { apiErrorText } from "@/lib/errors/catalog";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

interface ElectionDetailClientProps {
  id: string;
  /** Server-rendered first paint. Null when the server load failed or the
   *  viewer is unauthenticated — the client then falls back to fetching. */
  initialElection: ElectionDetail | null;
}

export function ElectionDetailClient({ id, initialElection }: ElectionDetailClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cycle = searchParams.get("cycle");
  const { showToast } = useToast();
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog();

  const [election, setElection] = useState<ElectionDetail | null>(initialElection);
  const [wire, setWire] = useState<string[]>([]);
  const [results, setResults] = useState<ElectionResultsResponse | null>(null);
  const [loading, setLoading] = useState(initialElection === null);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const fallbackCountry = searchParams.get("country")?.toUpperCase() === "UK" ? "uk" : "us";

  // Preset-aware cycle anchor (1991 vs 2019 starting-year). Read here so the
  // hook fires unconditionally on every render — it MUST sit above the
  // `loading` / `error` early-returns below, otherwise React reports a
  // "rendered more hooks than during the previous render" violation when
  // the loading state flips from true to false.
  const turnStatus = useGameTurnStatus();
  const larpBaseYear = turnStatus?.startingYear ?? DEFAULT_CYCLE_ANCHOR_CONTEXT.startingYear;
  const cycleCtx = {
    startingYear: larpBaseYear,
    preset: turnStatus?.preset ?? DEFAULT_CYCLE_ANCHOR_CONTEXT.preset,
  };

  // US presidential final hour: from the last turn interval the page watches
  // the results payload and hands the whole screen to the election-night
  // broadcast while `night` is present. `pending` holds the normal screen back
  // until the first payload lands, so no pre-night projection flashes.
  const nightWatch = useNightWatch(
    election?.id ?? null,
    election != null && isNightWindow(election)
  );

  const fetchElection = useCallback(async () => {
    try {
      const url = cycle
        ? `/api/elections?id=${encodeURIComponent(id)}&view=full&cycle=${cycle}`
        : `/api/elections?id=${encodeURIComponent(id)}&view=full`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          // Try to find the current active presidential election and redirect to it
          try {
            const presRes = await fetch("/api/elections/active-president");
            if (presRes.ok) {
              const presData = await presRes.json();
              if (presData.id && presData.id !== id) {
                router.replace(`/elections/${presData.id}`);
                return;
              }
            }
          } catch {
            // non-fatal — fall through to error display
          }
          setError("Election not found");
        } else {
          setError("Failed to load election");
        }
        return;
      }
      const wrapper = await res.json();
      const data: ElectionDetail = {
        ...wrapper.election,
        allCandidates: wrapper.election.candidates,
      };
      setElection(data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [id, cycle, router]);

  // The server already rendered `initialElection`; refetching immediately would
  // double every page load for no new data. Later polls still run below.
  const seededRef = React.useRef(initialElection !== null);
  useEffect(() => {
    if (seededRef.current) {
      seededRef.current = false;
      return;
    }
    fetchElection();
  }, [fetchElection]);

  // Per-race wire headlines for the Blend ticker. A quiet race returns an
  // empty list and the strip renders nothing.
  //
  // Polled on the same cadence as the race itself (see the interval below).
  // Fetching once would freeze the strip at page load: the delegate race and
  // the board would move on a turn boundary while the returns beside them still
  // showed whatever had happened before the reader opened the page.
  const fetchWire = React.useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/elections/${id}/wire?limit=8`, { signal });
        if (!res.ok) return;
        const data = await res.json();
        setWire(
          Array.isArray(data?.items)
            ? data.items.map((i: { headline: string }) => i.headline).filter(Boolean)
            : []
        );
      } catch {
        // non-critical: the ticker keeps whatever it last had
      }
    },
    [id]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchWire(controller.signal);
    return () => controller.abort();
  }, [fetchWire]);

  // A concluded presidential race renders the Blend results screen, which is
  // built over the live-results payload (it carries the called flags and the
  // EV threshold the detail payload does not).
  //
  // Keyed on `election.id`, NOT the route param. A Previous/Next link carries
  // the seat-id form ("/elections/US-president?cycle=3"), so on a historical
  // race the param is "US-president" and the results route rejects it with a
  // 400 — which silently dropped every past presidential race back to the
  // legacy view. `election.id` is always the resolved ObjectId. Same rule the
  // sub-region maps in GeneralPhaseView already follow.
  const resultsId = election?.id ?? null;
  const needsResults =
    election?.isEnded === true &&
    (election.electionType === "president" ||
      election.allCandidates.some((candidate) => candidate.isYou));
  useEffect(() => {
    if (!needsResults || !resultsId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/elections/${resultsId}/results`);
        if (!res.ok) return;
        const payload = (await res.json()) as ElectionResultsResponse;
        // Defensive against a stale proxy/cache response as well as client
        // navigation races: a payload may render only the race it names.
        if (!cancelled && payload.election.id === resultsId) setResults(payload);
      } catch {
        // non-critical: the page falls back to the existing concluded view
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resultsId, needsResults]);

  useEffect(() => {
    if (
      !election?.isEnded ||
      !results ||
      !["resolved", "completed"].includes(results.election.status) ||
      getStoredConsent() !== "accepted"
    )
      return;
    const ownCandidateIds = new Set(
      election.allCandidates.filter((candidate) => candidate.isYou).map((candidate) => candidate.id)
    );
    const ownSeatedCandidate = results.candidates.find(
      (candidate) => ownCandidateIds.has(candidate.id) && (candidate.seatsProjected ?? 0) > 0
    );
    const winnerId =
      results.summary.projectedWinner && ownCandidateIds.has(results.summary.projectedWinner)
        ? results.summary.projectedWinner
        : ownSeatedCandidate?.id;
    if (!winnerId) return;
    const key = `ahd:election-won:${results.election.id}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
      const ranked = [...results.candidates].sort((a, b) => b.voteSharePct - a.voteSharePct);
      const winner = ranked.find((candidate) => candidate.id === winnerId);
      const runner = ownSeatedCandidate
        ? ranked.find((candidate) => (candidate.seatsProjected ?? 0) === 0)
        : ranked.find((candidate) => candidate.id !== winnerId);
      void captureProductEvent("election_won", {
        outcome_source: "client_view",
        election_id: results.election.id,
        office: results.election.electionType,
        nation_id: results.election.countryId,
        margin: (winner?.voteSharePct ?? 0) - (runner?.voteSharePct ?? 0),
      });
      void captureProductEvent("office_won", {
        office: results.election.electionType,
        nation_id: results.election.countryId,
      });
    } catch {
      // Analytics storage is optional.
    }
  }, [election, results]);

  useEffect(() => {
    let visibilityTimeout: ReturnType<typeof setTimeout> | null = null;

    // Debounced to prevent overlapping fetches on rapid tab focus events
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (visibilityTimeout) clearTimeout(visibilityTimeout);
        visibilityTimeout = setTimeout(() => {
          fetchElection();
          void fetchWire();
        }, 100);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchElection();
      void fetchWire();
    }, 60_000);

    return () => {
      clearInterval(t);
      if (visibilityTimeout) clearTimeout(visibilityTimeout);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchElection, fetchWire]);

  const [huDistrictId, setHuDistrictId] = useState("");
  const handleEnter = async () => {
    if (!election) return;
    let constituencyId: string | undefined;
    let japanShugiinListOrder: number | undefined;
    const japanMixed = election.japanShugiinRules?.ruleVersion === "mixed-1994-v1";
    if (
      election.countryId === "HU" &&
      election.electionType === "nationalAssembly" &&
      election.hungarianModernAssembly?.ruleVersion === "mixed-2011-v1"
    ) {
      const districts = huDistrictIds(election.state);
      const answer = window.prompt(`Choose your constituency number (1-${districts.length}).`);
      if (answer === null) return;
      const number = Number(answer.trim());
      if (!Number.isInteger(number) || number < 1 || number > districts.length) {
        showToast("Choose a valid constituency number in this region.", "error");
        return;
      }
      constituencyId = districts[number - 1];
    }
    if (japanMixed) {
      const districts = JP_SHUGIIN_1994_CONSTITUENCIES.filter(
        (district) => district.regionId === election.state
      );
      const districtAnswer = window.prompt(
        `Choose a constituency number (1-${districts.length}; blank for party-list only). See the statutory map on this page.`
      );
      if (districtAnswer === null) return;
      if (districtAnswer.trim()) {
        const number = Number(districtAnswer.trim());
        if (!Number.isInteger(number) || number < 1 || number > districts.length) {
          showToast("Choose a valid Shugiin constituency number.", "error");
          return;
        }
        constituencyId = districts[number - 1].id;
      }
      const listAnswer = window.prompt("Party-list position (1-300; blank for constituency only).");
      if (listAnswer === null) return;
      if (listAnswer.trim()) {
        const rank = Number(listAnswer.trim());
        if (!Number.isInteger(rank) || rank < 1 || rank > 300) {
          showToast("Choose a valid party-list position.", "error");
          return;
        }
        japanShugiinListOrder = rank;
      }
      if (!constituencyId && japanShugiinListOrder == null) {
        showToast("Choose a constituency, a party-list position, or both.", "error");
        return;
      }
    }
    if (
      !(await confirmDialog({
        title: "Enter this race?",
        message: "This will register your character as a candidate.",
        confirmLabel: "Enter race",
      }))
    )
      return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/elections/${id}/enter`, {
        method: "POST",
        ...(japanMixed
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(constituencyId ? { constituencyId } : {}),
                ...(japanShugiinListOrder != null ? { japanShugiinListOrder } : {}),
              }),
            }
          : constituencyId
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ constituencyId }),
              }
            : (election.hungarianAssemblyRound?.round === 1 ||
                  election.bulgarianFoundingRound?.round === 1 ||
                  Boolean(election.bulgarianFoundingRound?.newNominationDistrictIds?.length)) &&
                huDistrictId
              ? {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ constituencyId: huDistrictId }),
                }
              : {}),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message ?? "Entered race", "success");
        void import("@/lib/analytics/capture")
          .then(({ captureProductEvent }) => captureProductEvent("election_entered"))
          .catch(() => {});
        await fetchElection();
      } else {
        showToast(apiErrorText(data, "Failed to enter race"), "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!election) return;
    // Phase decides the consequence wording: general-phase withdrawals
    // destroy accumulated votes; primary withdrawals do not.
    const phase: "primary" | "general" | "unknown" = election.inPrimary
      ? "primary"
      : election.isEnded
        ? "unknown"
        : "general";
    if (
      !(await confirmDialog({
        title: "Confirm withdrawal",
        message: buildWithdrawalConfirmMessage(phase),
        confirmLabel: "Withdraw",
        destructive: true,
      }))
    )
      return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/elections/${id}/withdraw`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message ?? "Withdrawn from race", "success");
        await fetchElection();
      } else {
        showToast(apiErrorText(data, "Failed to withdraw"), "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <ElectionDetailSkeleton />;

  if (error || !election)
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-4xl px-6 py-12">
          <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
            <p className="text-error">{error || "Election not found"}</p>
            <div className="mt-4">
              <BackButton
                fallbackLabel="Back to Elections"
                fallbackHref={`/country/${fallbackCountry}/elections`}
              />
            </div>
          </div>
        </main>
      </div>
    );

  // Trust the server's phase calculation (uses game time service)
  const localIsUpcoming = election.isUpcoming;
  const localInPrimary = election.inPrimary;
  const localIsEnded = election.isEnded;

  const amInRace = election.allCandidates.some((c) => c.isYou);
  // Entry is only open during the primary phase for all candidates.
  const entryPhaseOpen = localInPrimary;
  const canEnter = entryPhaseOpen && !amInRace && !localIsEnded && election.myCharId !== null;
  const canWithdraw = amInRace && !localIsEnded;

  // Election year = the year the general election takes place (voting year).
  // Prefers the baked `electionYear` on the doc (set at spawn under the active
  // preset); falls back to the preset-aware `cycleCtx` for legacy/un-backfilled
  // rows so 1991 games still show 1992-era labels and 2019 games show 2024 GE.
  const electionYear = resolveElectionYear(election, cycleCtx);
  const activeParties = election.byParty.filter((g) => g.candidates.length > 0);

  const isGeneralPhase = !localInPrimary && !localIsUpcoming;
  const showGeneralPanel = isGeneralPhase;

  // How many candidates advance from the primary — driven by the country's
  // `governmentType` (presidential → 1, parliamentary → 3, onePartyState → 7),
  // except single-winner executive races (governor/president) which always
  // advance 1, and US House which advances 3 when redistricting is on.
  //
  // Resolved server-side in `_enrichElection` and read off the payload rather
  // than recomputed here: `getPrimaryWinnersForElection` needs gameState, so a
  // client-side call has to have the flag shipped to it and can silently
  // disagree with the cap the turn resolver actually enforced. Legacy payloads
  // without the field fall back to 1.
  const advancingCount = election.primaryAdvanceCount ?? 1;

  const currentResults = results?.election.id === election.id ? results : null;

  // The presidential stage's left rail opens with the cycle navigation, the
  // reader's own action on the race, and the two guides. These used to sit in
  // the old page header below the stage, which the desktop no longer renders.
  // `?state=OH` opens that state on the stage (the old per-state page
  // redirects here). Only a plain state code is honoured.
  const stateParam = searchParams.get("state")?.toUpperCase() ?? null;
  const focusStateParam = stateParam && /^[A-Z]{2}$/.test(stateParam) ? stateParam : null;

  const stageRailTop = (
    <div>
      <ElectionNavigation election={election} showLiveLink={presidentialResultsLive(election)} />
      {canEnter &&
        (election.bulgarianFoundingRound?.round === 1 ||
          Boolean(election.bulgarianFoundingRound?.newNominationDistrictIds?.length)) && (
          <BgFoundingConstituencyPicker
            allowedDistrictIds={election.bulgarianFoundingRound?.newNominationDistrictIds}
            regionId={election.state}
            value={huDistrictId}
            onChange={setHuDistrictId}
          />
        )}
      {canEnter && election.hungarianAssemblyRound?.round === 1 && (
        <Hu1991ConstituencyPicker
          allowedDistrictIds={election.hungarianAssemblyRound?.vacancyDistrictIds}
          regionId={election.state}
          value={huDistrictId}
          onChange={setHuDistrictId}
        />
      )}
      {election.myCharId && !localIsEnded && (canEnter || canWithdraw) ? (
        <div className="mb-3 flex gap-2">
          {canEnter && (
            <button
              onClick={handleEnter}
              disabled={actionLoading}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {actionLoading ? "…" : "Enter race"}
            </button>
          )}
          {canWithdraw && (
            <button
              onClick={handleWithdraw}
              disabled={actionLoading}
              className="flex-1 rounded-lg border border-error/50 bg-error/10 px-4 py-2 text-sm font-semibold text-error transition-colors hover:bg-error/20 disabled:opacity-50"
            >
              {actionLoading ? "…" : "Withdraw"}
            </button>
          )}
        </div>
      ) : null}
      <p className="mb-1 text-xs text-muted">
        <Link href="/wiki/reference-offices" className="text-primary hover:underline">
          What the presidency can do
        </Link>
        {" · "}
        <Link href="/guides/running-for-office" className="text-primary hover:underline">
          How to run for president
        </Link>
      </p>
    </div>
  );

  // Below the stage only what the stage does not already show: the admin
  // tools, for admins. The old "Also on this race" block (the old header, a
  // second map, the trends, the schedule, a second results table) repeated the
  // stage and is gone.
  const desktopTail = election.isAdmin ? (
    <div className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
      <AdminSection
        electionId={id}
        electionType={election.electionType}
        isAdmin={election.isAdmin}
        adminOpen={adminOpen}
        localInPrimary={localInPrimary}
        localIsEnded={localIsEnded}
        candidates={election.allCandidates}
        onToggleAdmin={() => setAdminOpen((o) => !o)}
        onSuccess={fetchElection}
      />
    </div>
  ) : null;

  // The primary's campaign tooling is not on the stage anywhere, so it stays
  // below the field.
  const primaryCampaignTools =
    election.countryId === "US" ? (
      <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
        {!!election.myCharId && (
          <section id="state-org" className="mt-6 scroll-mt-6">
            <StateOrganizationTab showHubLink />
          </section>
        )}
        <CampaignsListPanel electionId={id} />
        {!!election.myCharId && <CampaignManagerTab electionId={id} />}
      </div>
    ) : null;

  if (nightWatch.pending) return <ElectionDetailSkeleton />;
  if (nightWatch.hold.show && nightWatch.data) {
    return (
      <div className="min-h-screen" style={{ background: BLEND.page, color: BLEND.ink }}>
        {confirmDialogNode}
        <NightBroadcast
          data={nightWatch.data}
          contingent={{ result: election.generalVotes?.contingentResult }}
          concludedHref={`/elections/${election.id}`}
          onContinue={nightWatch.hold.dismiss}
        />
      </div>
    );
  }

  // Concluded presidential race: the same Blend results screen the live
  // dashboard uses, chipped "Concluded". Falls through to the existing view
  // until the results payload arrives, or if it fails to load.
  if (election.electionType === "president" && localIsEnded && currentResults) {
    return (
      <div className="min-h-screen" style={{ background: BLEND.page, color: BLEND.ink }}>
        {confirmDialogNode}
        <ResultsBlendView
          data={currentResults}
          route="concluded"
          election={election}
          stageTitle={presidentialTitle(electionYear)}
          stageNav={stageRailTop}
          initialFocus={focusStateParam}
        />

        {desktopTail}
      </div>
    );
  }

  // Proposal D's general screen is the presidential electoral-college view: an
  // EV bar, a state tile board and persuasion drivers. Down-ballot races have
  // no college, so they keep the existing view.
  if (
    election.countryId !== "RU" &&
    election.electionType === "president" &&
    isGeneralPhase &&
    !localIsEnded &&
    !localIsUpcoming
  ) {
    return (
      <div className="min-h-screen" style={{ background: BLEND.page, color: BLEND.ink }}>
        {confirmDialogNode}
        <GeneralBlendView
          election={election}
          electionId={id}
          wire={wire}
          onRefresh={fetchElection}
          stageTitle={presidentialTitle(electionYear)}
          stageNav={stageRailTop}
          initialFocus={focusStateParam}
        />

        {/* Everything the hero above does not already say. The college bar, the
            per-ticket tally and the deadline strip all appear up there, so the
            blocks below are asked to leave them out rather than print the same
            standing twice on one page. */}
        {desktopTail}
      </div>
    );
  }

  // Proposal D covers the presidential primary specifically: a delegate race
  // across party fields. Down-ballot races have no delegate model, so they keep
  // the existing view.
  if (
    election.countryId !== "RU" &&
    election.electionType === "president" &&
    localInPrimary &&
    !localIsUpcoming
  ) {
    return (
      <div className="min-h-screen" style={{ background: BLEND.page, color: BLEND.ink }}>
        {confirmDialogNode}
        <PrimaryBlendView
          election={election}
          wire={wire}
          stageTitle={presidentialTitle(electionYear)}
          stageNav={stageRailTop}
          initialFocus={focusStateParam}
        />

        {desktopTail}
        {primaryCampaignTools}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        <ElectionNavigation election={election} />
        {confirmDialogNode}

        {canEnter &&
          (election.bulgarianFoundingRound?.round === 1 ||
            Boolean(election.bulgarianFoundingRound?.newNominationDistrictIds?.length)) && (
            <BgFoundingConstituencyPicker
              allowedDistrictIds={election.bulgarianFoundingRound?.newNominationDistrictIds}
              regionId={election.state}
              value={huDistrictId}
              onChange={setHuDistrictId}
            />
          )}
        {canEnter && election.hungarianAssemblyRound?.round === 1 && (
          <Hu1991ConstituencyPicker
            allowedDistrictIds={election.hungarianAssemblyRound?.vacancyDistrictIds}
            regionId={election.state}
            value={huDistrictId}
            onChange={setHuDistrictId}
          />
        )}
        <ElectionHeader
          election={election}
          electionYear={electionYear}
          localInPrimary={localInPrimary}
          localIsEnded={localIsEnded}
          localIsUpcoming={localIsUpcoming}
          canEnter={canEnter}
          canWithdraw={canWithdraw}
          actionLoading={actionLoading}
          onEnter={handleEnter}
          onWithdraw={handleWithdraw}
        />

        {/* Two columns from `lg` up. The old single `max-w-4xl` column left the
            right third of a desktop viewport empty on every state race. The
            rail carries the schedule and admin tools; the body carries the
            phase content. On mobile the grid collapses and the rail renders
            first, so the countdown stays above the fold. */}
        <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <aside className="lg:col-start-2 lg:row-start-1">
            <div className="lg:sticky lg:top-6">
              <ElectionScheduleCard
                election={election}
                localIsUpcoming={localIsUpcoming}
                localInPrimary={localInPrimary}
                localIsEnded={localIsEnded}
              />

              <AdminSection
                electionId={id}
                electionType={election.electionType}
                isAdmin={election.isAdmin}
                adminOpen={adminOpen}
                localInPrimary={localInPrimary}
                localIsEnded={localIsEnded}
                candidates={election.allCandidates}
                onToggleAdmin={() => setAdminOpen((o) => !o)}
                onSuccess={fetchElection}
              />

              {(localInPrimary || localIsUpcoming) && (
                <PrimaryMapPills election={election} activeParties={activeParties} />
              )}
            </div>
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <PrimaryPhaseNote
              election={election}
              localInPrimary={localInPrimary}
              advancingCount={advancingCount}
            />

            {localIsUpcoming ? (
              <UpcomingElectionView
                election={election}
                electionId={id}
                activeParties={activeParties}
                canEnter={canEnter}
                actionLoading={actionLoading}
                advancingCount={advancingCount}
                onEnter={handleEnter}
                onRemoveSuccess={fetchElection}
              />
            ) : showGeneralPanel ? (
              <GeneralPhaseView
                election={election}
                electionId={id}
                localInPrimary={localInPrimary}
                localIsEnded={localIsEnded}
                amInRace={amInRace}
                onSuccess={fetchElection}
              />
            ) : (
              <PrimaryPhaseView
                election={election}
                electionId={id}
                activeParties={activeParties}
                localInPrimary={localInPrimary}
                localIsEnded={localIsEnded}
                canEnter={canEnter}
                actionLoading={actionLoading}
                advancingCount={advancingCount}
                onEnter={handleEnter}
                onRemoveSuccess={fetchElection}
              />
            )}

            {/* Campaign Presence is the presidential ground-game build-up
                loop. It lives on Political Operations, but that page is not
                where candidates actually sit. Surface the builder here for
                every phase, including upcoming (you invest between cycles). */}
            {election.countryId === "US" &&
              election.electionType === "president" &&
              !!election.myCharId && (
                <section id="state-org" className="mt-6 scroll-mt-6">
                  <StateOrganizationTab showHubLink />
                </section>
              )}

            {/* Campaign panels — shown for all non-upcoming US presidential
                elections (components return null gracefully when no campaigns
                exist yet) */}
            {election.countryId === "US" &&
              election.electionType === "president" &&
              !localIsUpcoming && (
                <>
                  <CampaignsListPanel electionId={id} />
                  {!!election.myCharId && <CampaignManagerTab electionId={id} />}
                </>
              )}
          </div>
        </div>
      </main>
    </div>
  );
}
