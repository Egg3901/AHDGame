"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/contexts/ToastContext";
import { resolveElectionYear } from "@/lib/utils/formatters";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { DEFAULT_CYCLE_ANCHOR_CONTEXT } from "@/lib/elections/cycleAnchorContext";
import { ElectionNavigation } from "./ElectionNavigation";
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
import { ResultsBlendView } from "../blend/ResultsBlendView";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { BLEND } from "@/components/blend/tokens";
import { BlendScope } from "@/components/blend/BlendScope";
import { buildWithdrawalConfirmMessage } from "@/lib/elections/withdrawalWarning";

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
  const needsResults = election?.electionType === "president" && election?.isEnded === true;
  useEffect(() => {
    if (!needsResults) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/elections/${id}/results`);
        if (!res.ok) return;
        const payload = await res.json();
        if (!cancelled) setResults(payload);
      } catch {
        // non-critical: the page falls back to the existing concluded view
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, needsResults]);

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

  const handleEnter = async () => {
    if (!election) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/elections/${id}/enter`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message ?? "Entered race", "success");
        await fetchElection();
      } else {
        showToast(data.error ?? "Failed to enter race", "error");
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
    if (!confirm(buildWithdrawalConfirmMessage(phase))) return;
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
        showToast(data.error ?? "Failed to withdraw", "error");
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

  // Concluded presidential race: the same Blend results screen the live
  // dashboard uses, chipped "Concluded". Falls through to the existing view
  // until the results payload arrives, or if it fails to load.
  if (election.electionType === "president" && localIsEnded && results) {
    return (
      <div className="min-h-screen" style={{ background: BLEND.page, color: BLEND.ink }}>
        <ResultsBlendView data={results} route="concluded" />

        <BlendScope title="Also on this race">
          <GeneralPhaseView
            election={election}
            electionId={id}
            localInPrimary={localInPrimary}
            localIsEnded={localIsEnded}
            amInRace={amInRace}
            onSuccess={fetchElection}
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
        </BlendScope>
      </div>
    );
  }

  // Proposal D's general screen is the presidential electoral-college view: an
  // EV bar, a state tile board and persuasion drivers. Down-ballot races have
  // no college, so they keep the existing view.
  if (
    election.electionType === "president" &&
    isGeneralPhase &&
    !localIsEnded &&
    !localIsUpcoming
  ) {
    return (
      <div className="min-h-screen" style={{ background: BLEND.page, color: BLEND.ink }}>
        <GeneralBlendView
          election={election}
          electionId={id}
          wire={wire}
          onRefresh={fetchElection}
        />

        <BlendScope
          title="Also on this race"
          lede="The full map, the schedule, and your campaign operations."
        >
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

          <GeneralPhaseView
            election={election}
            electionId={id}
            localInPrimary={localInPrimary}
            localIsEnded={localIsEnded}
            amInRace={amInRace}
            onSuccess={fetchElection}
          />

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

          {election.countryId === "US" && !!election.myCharId && (
            <section id="state-org" className="mt-6 scroll-mt-6">
              <StateOrganizationTab showHubLink />
            </section>
          )}

          {election.countryId === "US" && (
            <>
              <CampaignsListPanel electionId={id} />
              {!!election.myCharId && <CampaignManagerTab electionId={id} />}
            </>
          )}
        </BlendScope>
      </div>
    );
  }

  // Proposal D covers the presidential primary specifically: a delegate race
  // across party fields. Down-ballot races have no delegate model, so they keep
  // the existing view.
  if (election.electionType === "president" && localInPrimary && !localIsUpcoming) {
    return (
      <div className="min-h-screen" style={{ background: BLEND.page, color: BLEND.ink }}>
        <PrimaryBlendView election={election} wire={wire} />

        <BlendScope
          title="Also on this race"
          lede="Filing, the schedule, the state map, and your campaign operations."
        >
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

          <ElectionScheduleCard
            election={election}
            localIsUpcoming={localIsUpcoming}
            localInPrimary={localInPrimary}
            localIsEnded={localIsEnded}
          />

          <PrimaryMapPills election={election} activeParties={activeParties} />

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

          {election.countryId === "US" && !!election.myCharId && (
            <section id="state-org" className="mt-6 scroll-mt-6">
              <StateOrganizationTab showHubLink />
            </section>
          )}

          {election.countryId === "US" && (
            <>
              <CampaignsListPanel electionId={id} />
              {!!election.myCharId && <CampaignManagerTab electionId={id} />}
            </>
          )}
        </BlendScope>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        <ElectionNavigation election={election} />

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
