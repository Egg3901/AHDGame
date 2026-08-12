import { describe, it, expect } from "vitest";
import type { Bill } from "@/lib/db/types";
import { resolveOtherVoteChamberKey, resolvePrimaryVoteChamberKey } from "./billVoteChamberScope";

type ScopedBill = Pick<Bill, "status" | "currentChamber" | "originChamber">;

const bill = (over: Partial<ScopedBill>): ScopedBill =>
  ({ status: "active", currentChamber: "house", originChamber: "house", ...over }) as ScopedBill;

describe("resolvePrimaryVoteChamberKey", () => {
  it("uses the origin chamber for an ordinary bill", () => {
    expect(resolvePrimaryVoteChamberKey(bill({ originChamber: "senate" }), "house")).toBe("senate");
  });

  it("has no origin roster during cabinet review", () => {
    expect(
      resolvePrimaryVoteChamberKey(bill({ status: "cabinet_review" }), "house")
    ).toBeUndefined();
  });

  it("follows currentChamber on a Shugiin override", () => {
    expect(
      resolvePrimaryVoteChamberKey(
        bill({ status: "override_shugiin", currentChamber: "shugiin" }),
        "shugiin"
      )
    ).toBe("shugiin");
  });

  it("maps a cabinet-origin bill onto the lower chamber", () => {
    expect(resolvePrimaryVoteChamberKey(bill({ originChamber: "cabinet" }), "shugiin")).toBe(
      "shugiin"
    );
  });
});

describe("resolveOtherVoteChamberKey", () => {
  it("follows currentChamber on the sequential crossover — the bill has moved", () => {
    expect(
      resolveOtherVoteChamberKey(
        bill({ status: "active_other", currentChamber: "senate" }),
        "senate"
      )
    ).toBe("senate");
  });

  it("names the upper chamber on a concurrent bill, whose currentChamber never moves", () => {
    // The regression this guards: `currentChamber` stays "house", so scoping the
    // second tally by it resolves to the house office type and silently discards
    // every senator's vote.
    expect(
      resolveOtherVoteChamberKey(bill({ status: "active_both", currentChamber: "house" }), "senate")
    ).toBe("senate");
  });

  it("falls back to currentChamber when the country has no elected upper chamber", () => {
    expect(
      resolveOtherVoteChamberKey(bill({ status: "active_both", currentChamber: "bundestag" }), null)
    ).toBe("bundestag");
  });
});
