/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildBlendRegionCards } from "@/lib/elections/blendRegionViewModel";
import type { ElectionDisplay } from "@/lib/db/types";
import { BlendRaceCard } from "./BlendRaceCard";

const parties = {
  abbr: (id: string) => ({ "1": "DEM", "2": "REP" })[id] ?? id.toUpperCase(),
  name: (id: string) => ({ "1": "Democratic Party", "2": "Republican Party" })[id] ?? id,
  color: (id: string) => ({ "1": "#3B82F6", "2": "#EF4444" })[id] ?? "#9CA3AF",
};

function candidate(id: string, name: string, party: string) {
  return {
    id,
    characterId: `char-${id}`,
    characterName: name,
    party,
    partyName: parties.name(party),
    partyColor: parties.color(party),
  };
}

/**
 * A three-person Senate race where a fourth candidate withdrew after ballots
 * were banked: the tally and polling still carry her id, but the roster does
 * not, so the card's tally rows cannot list her. A production-shaped partial
 * record: her name survives only in the polling maps.
 */
function threeWayRace(): ElectionDisplay {
  return {
    id: "e-senate",
    electionType: "senate",
    state: "GA",
    countryId: "US",
    cycle: 1,
    status: "active",
    totalSeats: 1,
    candidates: [
      candidate("s1", "Cleo Vance", "2"),
      candidate("s2", "Dax Hale", "1"),
      candidate("s3", "Ivy Moss", "1"),
    ],
    polling: {
      leaderId: "s1",
      leaderName: "Cleo Vance",
      leaderParty: "2",
      sharesPct: { s1: 55, s2: 35, s4: 10 },
      candidateNames: { s4: "June Park" },
      candidateParties: { s4: "1" },
      source: "general",
    },
    generalTally: {
      totalVotes: { s1: 30_000, s2: 20_000, s4: 5_000 },
      turnSnapshots: [],
    },
  } as ElectionDisplay;
}

function show(election: ElectionDisplay) {
  const [card] = buildBlendRegionCards({
    countryId: "US",
    regionName: "Georgia",
    parties,
    elections: [election],
    titleById: { [election.id]: "Georgia Senate" },
    hrefById: { [election.id]: `/elections/${election.id}` },
  });
  render(
    <BlendRaceCard
      card={card}
      closesIn="2d"
      closed={false}
      entryAction="none"
      entryLoading={false}
      onEnterRace={vi.fn()}
      onWithdraw={vi.fn()}
    />
  );
  return card;
}

describe("BlendRaceCard omitted candidates", () => {
  it("links a three-person race's omitted candidate to the full race exactly once", () => {
    const card = show(threeWayRace());
    expect(card.omittedCount).toBe(1);
    const links = screen.getAllByRole("link", { name: "+1 more candidate" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/elections/e-senate");
  });

  it("stays silent when the card lists the complete field", () => {
    const race = threeWayRace();
    race.polling = {
      ...race.polling!,
      sharesPct: { s1: 60, s2: 40 },
    };
    race.generalTally = { totalVotes: { s1: 30_000, s2: 20_000 }, turnSnapshots: [] };
    show(race);
    expect(screen.queryByRole("link", { name: /more candidate/ })).toBeNull();
  });
});
