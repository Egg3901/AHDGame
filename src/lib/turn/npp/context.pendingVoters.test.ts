import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Bill, ElectedOfficial, State, StateBill } from "@/lib/db/types";
import { collectPendingNppVoterIds } from "./context";

const now = new Date("2026-09-21T00:00:00.000Z");

function official(id: ObjectId, overrides: Partial<ElectedOfficial> = {}): ElectedOfficial {
  return {
    _id: new ObjectId(),
    characterId: null,
    countryId: "US",
    officeType: "house",
    isNPP: true,
    nppId: id,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function collect(opts: {
  officials: ElectedOfficial[];
  bills?: Bill[];
  stateBills?: StateBill[];
  states?: State[];
}): string[] {
  return collectPendingNppVoterIds({
    officials: opts.officials,
    bills: opts.bills ?? [],
    stateBills: opts.stateBills ?? [],
    states: opts.states ?? [],
    now,
    currentTurn: 73,
  }).map(String);
}

describe("collectPendingNppVoterIds", () => {
  it("omits officials who already voted and unrelated chambers", () => {
    const voted = new ObjectId();
    const pending = new ObjectId();
    const senator = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "active",
      currentChamber: "house",
      votes: { [`npp_${voted}`]: "for" },
    } as Bill;

    expect(
      collect({
        officials: [
          official(voted),
          official(pending),
          official(senator, { officeType: "senate" }),
        ],
        bills: [bill],
      })
    ).toEqual([pending.toString()]);
  });

  it("checks each chamber vote map for concurrent bills", () => {
    const representative = new ObjectId();
    const senator = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "active_both",
      votes: { [`npp_${representative}`]: "for" },
      otherChamberVotes: {},
      votingEndsOnTurn: 74,
      otherChamberVotingEndsOnTurn: 74,
    } as Bill;

    expect(
      collect({
        officials: [official(representative), official(senator, { officeType: "senate" })],
        bills: [bill],
      })
    ).toEqual([senator.toString()]);
  });

  it("includes only pending NPPs in the state's configured legislature", () => {
    const voted = new ObjectId();
    const pending = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      stateId: "CA",
      status: "active",
      votes: { [`npp_${voted}`]: "against" },
    } as StateBill;
    const state = { _id: "CA", countryId: "US" } as State;

    expect(
      collect({
        officials: [
          official(voted, { officeType: "stateSenate", state: "CA" }),
          official(pending, { officeType: "stateSenate", state: "CA" }),
        ],
        stateBills: [bill],
        states: [state],
      })
    ).toEqual([pending.toString()]);
  });
});
