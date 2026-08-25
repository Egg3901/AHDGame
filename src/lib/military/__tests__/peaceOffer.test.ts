import { describe, it, expect } from "vitest";
import {
  isOfferLive,
  validatePeaceOffer,
  sideWouldEmpty,
  maxIndemnityForGdp,
  PEACE_INDEMNITY_MAX_GDP_SHARE,
} from "../peaceOffer";
import { PEACE_OFFER_DURATION_TURNS, TRUCE_TURNS } from "@/lib/db/types/peaceOffer";
import type { ConflictDoc } from "@/lib/db/types/conflict";

const conflict = {
  _id: "t1",
  status: "active",
  sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition" },
  sideB: { label: "PLA", countries: ["CN"], kind: "state" },
} as unknown as ConflictDoc;

const indemnity = { payer: "UK" as const, amount: 100 };

describe("isOfferLive", () => {
  it("is live while pending and inside the window", () => {
    expect(isOfferLive({ status: "pending", expiresTurn: 50 }, 49)).toBe(true);
  });

  it("is dead ON the expiry turn", () => {
    expect(isOfferLive({ status: "pending", expiresTurn: 50 }, 50)).toBe(false);
  });

  it("is dead past the window even though status still says pending", () => {
    // The lazy-expiry rule. A reader checking only `status` would accept this.
    expect(isOfferLive({ status: "pending", expiresTurn: 50 }, 51)).toBe(false);
  });

  it("is dead once resolved, whatever the turn", () => {
    for (const status of ["accepted", "rejected", "withdrawn", "expired"] as const) {
      expect(isOfferLive({ status, expiresTurn: 999 }, 1)).toBe(false);
    }
  });
});

describe("validatePeaceOffer", () => {
  it("accepts opposed belligerents", () => {
    expect(validatePeaceOffer(conflict, "UK", "CN", indemnity)).toEqual({ ok: true });
  });

  it("refuses a resolved war", () => {
    const done = { ...conflict, status: "resolved" } as ConflictDoc;
    expect(validatePeaceOffer(done, "UK", "CN", indemnity).ok).toBe(false);
  });

  it("refuses two countries on the SAME side", () => {
    const r = validatePeaceOffer(conflict, "US", "UK", { payer: "US", amount: 0 });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/same side/i);
  });

  it("refuses a country that is not in the war", () => {
    const r = validatePeaceOffer(conflict, "UK", "RU", indemnity);
    expect(r.ok).toBe(false);
    // Its own message: "not in this war" is a different problem from "same side",
    // and an offerer can only act on the right one.
    expect((r as { error: string }).error).toMatch(/belligerent/i);
  });

  it("refuses a generated enemy — there is nobody to negotiate with", () => {
    // A generated side is defined by an EMPTY roster, which is the realistic shape.
    const gen = {
      ...conflict,
      sideB: { label: "Insurgents", countries: [], kind: "generated" },
    } as unknown as ConflictDoc;
    const r = validatePeaceOffer(gen, "UK", "CN", indemnity);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/no government/i);
  });

  it("names the generated problem, NOT a roster problem", () => {
    // Ordering regression. A generated side has countries: [], so a membership
    // check running first would report "must be belligerents" — true but useless,
    // since no roster edit could ever make that offer valid.
    const gen = {
      ...conflict,
      sideB: { label: "Insurgents", countries: [], kind: "generated" },
    } as unknown as ConflictDoc;
    const r = validatePeaceOffer(gen, "UK", "CN", indemnity);
    expect((r as { error: string }).error).not.toMatch(/belligerent/i);
  });

  it("refuses a negative indemnity", () => {
    expect(validatePeaceOffer(conflict, "UK", "CN", { payer: "UK", amount: -1 }).ok).toBe(false);
  });

  it("refuses a NaN indemnity", () => {
    // `amount < 0` would let NaN through, and NaN would then be $inc'd into a
    // treasury. The check is written as !(amount >= 0) precisely for this.
    expect(validatePeaceOffer(conflict, "UK", "CN", { payer: "UK", amount: NaN }).ok).toBe(false);
  });

  it("refuses a payer who is not one of the two parties", () => {
    // US is a belligerent, but not a party to THIS offer — it cannot be billed for
    // a deal it is not in.
    expect(validatePeaceOffer(conflict, "UK", "CN", { payer: "US", amount: 5 }).ok).toBe(false);
  });

  it("accepts a zero indemnity — that is a white peace", () => {
    expect(validatePeaceOffer(conflict, "UK", "CN", { payer: "UK", amount: 0 })).toEqual({
      ok: true,
    });
  });

  it("accepts EITHER party as payer", () => {
    // A winning country may pay to disengage from a war it no longer wants.
    expect(validatePeaceOffer(conflict, "UK", "CN", { payer: "CN", amount: 5 })).toEqual({
      ok: true,
    });
  });

  it("does not care whether the payer can afford it", () => {
    // Deliberate: treasuryBalance is a signed position, and a country already in
    // debt must still be able to buy peace. (No cap passed — affordability and the
    // GDP ceiling are separate concerns; the ceiling is exercised below.)
    expect(validatePeaceOffer(conflict, "UK", "CN", { payer: "UK", amount: 1e15 })).toEqual({
      ok: true,
    });
  });

  it("refuses an indemnity above the payer's GDP-share ceiling when a cap is passed", () => {
    // The exploit: without a ceiling, `amount: 1e15` is accepted and moved on
    // accept, draining the payer treasury arbitrarily. With the GDP cap it is
    // rejected at offer time.
    const r = validatePeaceOffer(conflict, "UK", "CN", { payer: "UK", amount: 1e15 }, 1000);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/GDP/i);
  });

  it("accepts an indemnity exactly at the ceiling", () => {
    expect(validatePeaceOffer(conflict, "UK", "CN", { payer: "UK", amount: 1000 }, 1000)).toEqual({
      ok: true,
    });
  });
});

describe("maxIndemnityForGdp", () => {
  it("is the configured multiple of GDP", () => {
    expect(maxIndemnityForGdp(500)).toBe(500 * PEACE_INDEMNITY_MAX_GDP_SHARE);
  });

  it("is null when GDP is missing or non-positive (no assumed fallback)", () => {
    // Same stance as unitPurchasePrice: an assumed GDP is an uncapped indemnity by
    // the back door, so a no-GDP payer gets no ceiling to compute an offer against.
    expect(maxIndemnityForGdp(0)).toBeNull();
    expect(maxIndemnityForGdp(-1)).toBeNull();
    expect(maxIndemnityForGdp(null)).toBeNull();
    expect(maxIndemnityForGdp(undefined)).toBeNull();
    expect(maxIndemnityForGdp(NaN)).toBeNull();
  });
});

describe("sideWouldEmpty", () => {
  it("returns null while allies remain", () => {
    expect(sideWouldEmpty(conflict, "UK")).toBeNull();
  });

  it("names the side that empties when the last member leaves", () => {
    expect(sideWouldEmpty(conflict, "CN")).toBe("B");
  });

  it("returns null for a country not on either roster", () => {
    expect(sideWouldEmpty(conflict, "RU")).toBeNull();
  });

  it("names side A when A is the one that would empty", () => {
    const solo = {
      ...conflict,
      sideA: { label: "UK", countries: ["UK"], kind: "state" },
    } as unknown as ConflictDoc;
    expect(sideWouldEmpty(solo, "UK")).toBe("A");
  });

  it("accepts a set of leavers and empties the side when they are all of it", () => {
    const pact = {
      sideA: { label: "US", countries: ["US"], kind: "state" },
      sideB: { label: "Pact", countries: ["DD", "RU"], kind: "coalition" },
    } as unknown as ConflictDoc;
    // Treaty release takes DD and RU out together. Asked about DD alone this returns
    // null, and the war would sit active with an empty side B and no winner.
    expect(sideWouldEmpty(pact, ["DD", "RU"])).toBe("B");
    expect(sideWouldEmpty(pact, ["DD"])).toBeNull();
  });

  it("ignores leavers that are not on the side", () => {
    const pact = {
      sideA: { label: "US", countries: ["US"], kind: "state" },
      sideB: { label: "Pact", countries: ["DD"], kind: "state" },
    } as unknown as ConflictDoc;
    expect(sideWouldEmpty(pact, ["DD", "PL"])).toBe("B");
  });

  // A generated side carries `countries: []`. Without the length guard an `every` over
  // an empty array is vacuously true and every insurgency would read as "emptied".
  it("never names a side that was already empty", () => {
    const generated = {
      sideA: { label: "Gov", countries: ["CN"], kind: "state" },
      sideB: { label: "Rebels", countries: [], kind: "generated" },
    } as unknown as ConflictDoc;
    expect(sideWouldEmpty(generated, ["CN"])).toBe("A");
  });
});

describe("validatePeaceOffer treaty bar", () => {
  const pact = {
    status: "active",
    sideA: { label: "US", countries: ["US"], kind: "state" },
    sideB: { label: "Pact", countries: ["DD", "RU"], kind: "coalition" },
    treatyEntries: [
      { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 5 },
    ],
  } as unknown as ConflictDoc;

  it("refuses an auto-joined ally while the country it defends still fights", () => {
    const res = validatePeaceOffer(pact, "RU", "US", { payer: "RU", amount: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Warsaw Pact");
      expect(res.error).toContain("East Germany");
      // Player-facing copy: no em or en dashes, in any language.
      expect(res.error).not.toMatch(/[—–]/);
    }
  });

  it("allows the ally once the defended country has left the war", () => {
    const settled = {
      ...pact,
      sideB: { label: "Pact", countries: ["RU"], kind: "coalition" },
    } as unknown as ConflictDoc;
    expect(validatePeaceOffer(settled, "RU", "US", { payer: "RU", amount: 0 }).ok).toBe(true);
  });

  it("never bars the defended country itself", () => {
    expect(validatePeaceOffer(pact, "DD", "US", { payer: "DD", amount: 0 }).ok).toBe(true);
  });

  // The OFFERER is the country that leaves (acceptPeace sets leaver = offer.fromCountry).
  // An attacker offering peace to an auto-joined ally is the attacker giving up, and must
  // not be refused.
  it("never bars the attacker from offering peace to an ally", () => {
    expect(validatePeaceOffer(pact, "US", "RU", { payer: "US", amount: 0 }).ok).toBe(true);
  });

  it("leaves a conflict with no treaty entries unaffected", () => {
    const plain = { ...pact, treatyEntries: undefined } as unknown as ConflictDoc;
    expect(validatePeaceOffer(plain, "RU", "US", { payer: "RU", amount: 0 }).ok).toBe(true);
  });
});

describe("constants", () => {
  it("stands an offer for 72 turns and a truce for 240", () => {
    // Player-facing copy renders from these, so a change here changes the UI too.
    expect(PEACE_OFFER_DURATION_TURNS).toBe(72);
    expect(TRUCE_TURNS).toBe(240);
  });
});

describe("findLiveOffer", () => {
  function stub(rows: unknown[]) {
    return {
      collection: () => ({ find: () => ({ toArray: async () => rows }) }),
    } as unknown as import("mongodb").Db;
  }

  it("ignores a stored-pending row whose window has passed", async () => {
    // The lazy-expiry rule at the query layer. Querying `status: "pending"` alone
    // would hand back a dead offer and let it be accepted.
    const { findLiveOffer } = await import("@/lib/db/collections/peaceOffers");
    const rows = [{ status: "pending", expiresTurn: 10 }];
    expect(await findLiveOffer(stub(rows), "t1", "UK", "CN", 11)).toBeNull();
  });

  it("returns the row while it is still inside its window", async () => {
    const { findLiveOffer } = await import("@/lib/db/collections/peaceOffers");
    const rows = [{ status: "pending", expiresTurn: 10 }];
    expect(await findLiveOffer(stub(rows), "t1", "UK", "CN", 9)).not.toBeNull();
  });
});
