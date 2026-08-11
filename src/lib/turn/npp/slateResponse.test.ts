import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { NPP } from "@/lib/db/types";
import { decideNPPSlateResponse, type SlateResponseInput } from "./slateResponse";

function makeNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "US_CA",
    party: "1",
    countryId: "US",
    policies: { economic: 0, social: 0 },
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    politicalInfluence: 10,
    favorability: 50,
    currentOffice: "house",
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as NPP;
}

function makeInput(overrides: Partial<SlateResponseInput> = {}): SlateResponseInput {
  return {
    npp: makeNPP(),
    assignerRole: null,
    isIncumbent: false,
    cooldownExpiry: null,
    now: new Date("2026-04-27T12:00:00Z"),
    ...overrides,
  };
}

describe("decideNPPSlateResponse — hard declines", () => {
  it("declines retired NPPs with a 'retired' reason", () => {
    const result = decideNPPSlateResponse(makeInput({ npp: makeNPP({ retiredAt: new Date() }) }));
    expect(result.status).toBe("declined");
    expect(result.refusalReason).toBe("retired");
  });

  it("declines NPPs whose cooldown is still active", () => {
    const now = new Date("2026-04-27T12:00:00Z");
    const future = new Date("2026-04-28T12:00:00Z");
    const result = decideNPPSlateResponse(makeInput({ now, cooldownExpiry: future }));
    expect(result.status).toBe("declined");
    expect(result.refusalReason).toBe("cooldown");
  });

  it("ignores expired cooldowns and accepts a compliant NPP", () => {
    const now = new Date("2026-04-27T12:00:00Z");
    const past = new Date("2026-04-26T12:00:00Z");
    const result = decideNPPSlateResponse(makeInput({ now, cooldownExpiry: past }));
    expect(result.status).toBe("accepted");
  });
});

describe("decideNPPSlateResponse — incumbents", () => {
  it("incumbents always accept regardless of compliance", () => {
    const result = decideNPPSlateResponse(
      makeInput({
        isIncumbent: true,
        npp: makeNPP({ personality: { loyalty: 0, ambition: 0, stubbornness: 100 } }),
      })
    );
    expect(result.status).toBe("accepted");
    expect(result.refusalReason).toBeNull();
    expect(result.fitScore).toBeGreaterThanOrEqual(80);
  });
});

describe("decideNPPSlateResponse — binary compliance", () => {
  it("accepts a compliant NPP (loyalty >= 40, stubbornness <= 70)", () => {
    const result = decideNPPSlateResponse(
      makeInput({ npp: makeNPP({ personality: { loyalty: 50, ambition: 50, stubbornness: 50 } }) })
    );
    expect(result.status).toBe("accepted");
    expect(result.refusalReason).toBeNull();
  });

  it("declines a disloyal NPP with low_compliance", () => {
    const result = decideNPPSlateResponse(
      makeInput({ npp: makeNPP({ personality: { loyalty: 30, ambition: 50, stubbornness: 50 } }) })
    );
    expect(result.status).toBe("declined");
    expect(result.refusalReason).toBe("low_compliance");
  });

  it("declines an overly stubborn NPP with low_compliance", () => {
    const result = decideNPPSlateResponse(
      makeInput({ npp: makeNPP({ personality: { loyalty: 60, ambition: 50, stubbornness: 80 } }) })
    );
    expect(result.status).toBe("declined");
    expect(result.refusalReason).toBe("low_compliance");
  });

  it("never returns considering", () => {
    for (const loyalty of [0, 20, 40, 41, 50, 60, 80, 100]) {
      for (const stubbornness of [0, 50, 70, 71, 100]) {
        const result = decideNPPSlateResponse(
          makeInput({ npp: makeNPP({ personality: { loyalty, ambition: 50, stubbornness } }) })
        );
        expect(["accepted", "declined"]).toContain(result.status);
      }
    }
  });
});

describe("decideNPPSlateResponse — state-chair bonus", () => {
  it("tips a borderline-disloyal NPP from declined to accepted when slated by a state chair", () => {
    // loyalty 37 fails baseline (>=40) but passes the state-chair reduced floor (>=35).
    const borderline = makeNPP({ personality: { loyalty: 37, ambition: 50, stubbornness: 50 } });
    const baseline = decideNPPSlateResponse(makeInput({ npp: borderline, assignerRole: null }));
    expect(baseline.status).toBe("declined");

    const buffed = decideNPPSlateResponse(
      makeInput({ npp: borderline, assignerRole: "state_chair" })
    );
    expect(buffed.status).toBe("accepted");
  });

  it("tips a borderline-stubborn NPP from declined to accepted when slated by a state chair", () => {
    // stubbornness 73 fails baseline (<=70) but passes the state-chair raised ceiling (<=75).
    const borderline = makeNPP({ personality: { loyalty: 60, ambition: 50, stubbornness: 73 } });
    const baseline = decideNPPSlateResponse(makeInput({ npp: borderline, assignerRole: null }));
    expect(baseline.status).toBe("declined");

    const buffed = decideNPPSlateResponse(
      makeInput({ npp: borderline, assignerRole: "state_vice_chair" })
    );
    expect(buffed.status).toBe("accepted");
  });
});
