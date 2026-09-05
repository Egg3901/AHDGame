import { describe, expect, it } from "vitest";
import { planStateRegDriftDecay } from "./regDriftDecay";
import type { StatePartyOrg, StateRegistrationPool } from "@/lib/db/types";
import { POOL_SENTINEL_PARTY_ID } from "@/lib/db/types";

function row(partyId: string, organization: number, registration: number): StatePartyOrg {
  return {
    _id: `CA_${partyId}`,
    countryId: "US",
    stateId: "CA",
    partyId,
    organization,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    treasury: 0,
    stateTaxRate: 0,
    politicalStrength: 0,
    hasPresence: true,
    registration,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const pool: StateRegistrationPool = {
  _id: "US_CA",
  countryId: "US",
  stateId: "CA",
  independent: 0,
  unregistered: 0,
  lastUpdatedTurn: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// The balance harness needs to replay the pre-change world, where decay never
// reached the pool while any party was eligible to catch it. Without this seam
// both arms of the report run the new lapse and the comparison is meaningless.
describe("planStateRegDriftDecay — decayLapseToPoolShare override", () => {
  it("defaults to the shipped lapse share, feeding the pool from decay", () => {
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties: [row("1", 20, 40), row("2", 40, 5)],
      pool: { ...pool },
      turn: 100,
      now: new Date(),
    });
    if (!planned) throw new Error("expected plan");
    const decayToPool = planned.ledgerRows.filter(
      (r) => r.source === "decay" && r.partyId === POOL_SENTINEL_PARTY_ID
    );
    expect(decayToPool.length).toBeGreaterThan(0);
  });

  it("routes no decay to the pool at share 0", () => {
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "CA",
      parties: [row("1", 20, 40), row("2", 40, 5)],
      pool: { ...pool },
      turn: 100,
      now: new Date(),
      decayLapseToPoolShare: 0,
    });
    if (!planned) throw new Error("expected plan");
    const decayToPool = planned.ledgerRows.filter(
      (r) => r.source === "decay" && r.partyId === POOL_SENTINEL_PARTY_ID
    );
    expect(decayToPool).toHaveLength(0);
  });
});
