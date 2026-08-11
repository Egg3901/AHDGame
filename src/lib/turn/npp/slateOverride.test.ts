import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { NPP, Election } from "@/lib/db/types";
import {
  slateSuppressesIncumbentDefense,
  slateSuppressesAutoPick,
  type SlateOverrideMaps,
} from "./slateOverride";

const PARTY = "12";
const ELECTION_ID = new ObjectId();

function makeNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    party: PARTY,
    personality: { loyalty: 80, ambition: 50, stubbornness: 20 },
    ...overrides,
  } as NPP;
}

function makeElection(id = ELECTION_ID): Election {
  return { _id: id, electionType: "governor", state: "TX" } as Election;
}

/** Chair is managing (PARTY, ELECTION_ID); npp is NOT on its slate. */
function chairManagedNoSlate(): SlateOverrideMaps {
  return {
    chairManagedByPartyElection: new Set([`${PARTY}:${ELECTION_ID.toString()}`]),
    slatedElectionIdsByNpp: new Map(),
  };
}

describe("slateSuppressesIncumbentDefense (#904)", () => {
  it("suppresses defense for a compliant incumbent the chair benched from a managed race", () => {
    expect(slateSuppressesIncumbentDefense(makeNPP(), makeElection(), chairManagedNoSlate())).toBe(
      true
    );
  });

  it("does NOT suppress when the incumbent IS on that race's slate (chair kept them)", () => {
    const npp = makeNPP();
    const maps = chairManagedNoSlate();
    maps.slatedElectionIdsByNpp.set(npp._id.toString(), new Set([ELECTION_ID.toString()]));
    expect(slateSuppressesIncumbentDefense(npp, makeElection(), maps)).toBe(false);
  });

  it("does NOT suppress a non-compliant (disloyal) incumbent — they still defend", () => {
    const disloyal = makeNPP({ personality: { loyalty: 20, ambition: 50, stubbornness: 20 } });
    expect(slateSuppressesIncumbentDefense(disloyal, makeElection(), chairManagedNoSlate())).toBe(
      false
    );
  });

  it("does NOT suppress a stubborn incumbent — they still defend", () => {
    const stubborn = makeNPP({ personality: { loyalty: 80, ambition: 50, stubbornness: 90 } });
    expect(slateSuppressesIncumbentDefense(stubborn, makeElection(), chairManagedNoSlate())).toBe(
      false
    );
  });

  it("does NOT suppress when no chair slate manages that race (full autonomy)", () => {
    const empty: SlateOverrideMaps = {
      chairManagedByPartyElection: new Set(),
      slatedElectionIdsByNpp: new Map(),
    };
    expect(slateSuppressesIncumbentDefense(makeNPP(), makeElection(), empty)).toBe(false);
  });

  it("does NOT suppress when the managed slate belongs to a different party", () => {
    const maps: SlateOverrideMaps = {
      chairManagedByPartyElection: new Set([`99:${ELECTION_ID.toString()}`]),
      slatedElectionIdsByNpp: new Map(),
    };
    expect(slateSuppressesIncumbentDefense(makeNPP(), makeElection(), maps)).toBe(false);
  });
});

describe("slateSuppressesAutoPick (#906)", () => {
  it("holds a compliant NPP with a chair-slate assignment out of generic auto-pick", () => {
    const npp = makeNPP();
    const maps: SlateOverrideMaps = {
      chairManagedByPartyElection: new Set([`${PARTY}:${ELECTION_ID.toString()}`]),
      slatedElectionIdsByNpp: new Map([[npp._id.toString(), new Set([ELECTION_ID.toString()])]]),
    };
    expect(slateSuppressesAutoPick(npp, maps)).toBe(true);
  });

  it("does NOT hold out a non-compliant NPP even with a slate row", () => {
    const disloyal = makeNPP({ personality: { loyalty: 10, ambition: 50, stubbornness: 20 } });
    const maps: SlateOverrideMaps = {
      chairManagedByPartyElection: new Set([`${PARTY}:${ELECTION_ID.toString()}`]),
      slatedElectionIdsByNpp: new Map([
        [disloyal._id.toString(), new Set([ELECTION_ID.toString()])],
      ]),
    };
    expect(slateSuppressesAutoPick(disloyal, maps)).toBe(false);
  });

  it("does NOT hold out a compliant NPP with no slate assignment", () => {
    const npp = makeNPP();
    const maps: SlateOverrideMaps = {
      chairManagedByPartyElection: new Set([`${PARTY}:${ELECTION_ID.toString()}`]),
      slatedElectionIdsByNpp: new Map(),
    };
    expect(slateSuppressesAutoPick(npp, maps)).toBe(false);
  });
});
