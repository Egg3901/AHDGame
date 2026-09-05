"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { StateOrganizationTab } from "@/app/political-operations/components/StateOrganizationTab";
import type { ElectionDetail } from "./ElectionDetailTypes";

const PresidentialMapWithStateDetail = dynamic(
  () =>
    import("./PresidentialMapWithStateDetail").then((m) => ({
      default: m.PresidentialMapWithStateDetail,
    })),
  { ssr: false }
);

type MapTab = "electoral" | "presence";

/**
 * The two full US maps of the same race, behind one tab.
 *
 * The page drew both at full size — the electoral map near the top and the
 * campaign-presence map further down — so a reader scrolled past the United
 * States twice to read two different things about the same fifty states. They
 * answer different questions ("who is winning here" and "what have I built
 * here") and both are worth keeping, but not stacked.
 *
 * The section sits where the electoral map used to, because that map has to
 * lead: the mood gauge, the factor ledger and the battleground shell below it
 * all decompose the thing it shows, and they only make sense once you have
 * seen it.
 */
export function RaceMapsSection({
  election,
  electionId,
}: {
  election: ElectionDetail;
  electionId: string;
}) {
  /**
   * Building presence needs a character. The standalone section this replaces
   * was gated on one, so without it the tab would open on a pane that can only
   * say no.
   */
  const canBuildPresence = !!election.myCharId;
  const [tab, setTab] = useState<MapTab>("electoral");

  /**
   * `#state-org` is a live deep link — the campaign manager on this page links
   * to it, and so does the presidential primary page from outside. Landing on
   * the section is no use if the pane they were sent to is the hidden one, so
   * the hash selects the tab. `hashchange` covers the same-page link, which
   * moves the hash without remounting anything.
   */
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#state-org" && canBuildPresence) setTab("presence");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [canBuildPresence]);

  const tabButton = (id: MapTab, label: string, rounding: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`px-3 py-1.5 text-sm font-medium transition-colors ${rounding} ${
        tab === id ? "bg-primary text-white" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section id="state-org" className="mt-6 scroll-mt-6">
      {/* With one pane there is nothing to swap between, so the section keeps
          out of the way entirely and the map wears its own heading again —
          the same page a character-less viewer saw before. */}
      {canBuildPresence && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Maps</h3>
          <div className="flex items-center rounded-lg border border-card-border bg-card">
            {tabButton("electoral", "Electoral", "rounded-l-lg")}
            {tabButton("presence", "Campaign presence", "rounded-r-lg")}
          </div>
        </div>
      )}

      {/* Both panes stay mounted. The presence map loads its own state list and
          the electoral map holds a selected state; unmounting on every tab
          switch would throw that away and refetch. */}
      <div hidden={canBuildPresence && tab !== "electoral"}>
        <PresidentialMapWithStateDetail
          electionId={electionId}
          electoralMapData={election.generalVotes?.electoralMapData ?? {}}
          electoralVotesByCandidate={election.generalVotes?.electoralVotesByCandidate}
          candidateNames={election.generalVotes?.candidateNames ?? {}}
          candidateParties={election.generalVotes?.candidateParties ?? {}}
          candidateColors={election.generalVotes?.candidateColors ?? {}}
          stateVoteData={election.generalVotes?.stateVoteData}
          stateVotesOverTime={election.generalVotes?.stateVotesOverTime}
          candidateTravelStates={Object.fromEntries(
            election.allCandidates.filter((c) => c.travelState).map((c) => [c.id, c.travelState!])
          )}
          showHeading={!canBuildPresence}
        />
      </div>

      {canBuildPresence && (
        <div hidden={tab !== "presence"}>
          <StateOrganizationTab showHubLink showHeading={false} />
        </div>
      )}
    </section>
  );
}
