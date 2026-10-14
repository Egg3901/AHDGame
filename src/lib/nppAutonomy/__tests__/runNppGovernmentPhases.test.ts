import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const levelMock = vi.hoisted(() => vi.fn(async () => "v6"));
const {
  getDbMock,
  registeredMock,
  atLeastMock,
  formCabinetMock,
  ministerialMock,
  caretakerMinistersMock,
  claimSlotMock,
  enabledForPlayersMock,
  foreignPolicyMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  registeredMock: vi.fn(),
  atLeastMock: vi.fn(),
  formCabinetMock: vi.fn(),
  ministerialMock: vi.fn(),
  caretakerMinistersMock: vi.fn(),
  claimSlotMock: vi.fn(),
  enabledForPlayersMock: vi.fn(),
  foreignPolicyMock: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: () => getDbMock() }));
vi.mock("@/lib/country/registeredCountries", () => ({
  getRegisteredCountryIds: (...a: unknown[]) => registeredMock(...a),
}));
vi.mock("../featureFlag", async (importOriginal) => ({
  nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a),
  // Lanes are a v6 (NPP engine 6) behaviour; the suite runs at v6 unless a
  // test sets the level itself.
  getNppAutonomyLevel: () => levelMock(),
  nppAutonomyLevelAtLeast: (await importOriginal<typeof import("../featureFlag")>())
    .nppAutonomyLevelAtLeast,
}));
vi.mock("../appointNppPresident", () => ({
  appointNppPresident: vi.fn().mockResolvedValue(false),
}));
vi.mock("../formNppCabinet", () => ({
  formNppCabinet: (...a: unknown[]) => formCabinetMock(...a),
}));
vi.mock("../ministerialGovernance", () => ({
  runMinisterialGovernance: (...a: unknown[]) => ministerialMock(...a),
  runCaretakerMinisters: (...a: unknown[]) => caretakerMinistersMock(...a),
}));
vi.mock("../tier1DecisionClaim", () => ({
  claimTier1NppDecisionSlot: (...a: unknown[]) => claimSlotMock(...a),
}));
vi.mock("@/lib/countryAccess", () => ({
  isCountryEnabledForPlayers: (...a: unknown[]) => enabledForPlayersMock(...a),
}));
vi.mock("../foreignPolicy", () => ({
  processAutonomousForeignPolicy: (...a: unknown[]) => foreignPolicyMock(...a),
}));

import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { NPP_GOVERNMENT_LANES, runNppGovernmentPhases } from "../processNppGovernment";

let db: MockDb;
let timeline: string[];
let inFlight: number;
let peakInFlight: number;
const now = new Date("2026-06-23T12:00:00Z");
const ORDER = Object.keys(COUNTRY_CONFIGS) as CountryId[];

beforeEach(() => {
  db = createMockDb();
  // No formed government: the agenda step reads null and no-ops.
  db.collection("governmentFormations").findOne.mockResolvedValue(null);
  getDbMock.mockReset().mockResolvedValue(db);
  registeredMock.mockReset().mockResolvedValue(ORDER);
  atLeastMock.mockReset().mockResolvedValue(true);
  enabledForPlayersMock.mockReset().mockResolvedValue(false);
  claimSlotMock.mockReset().mockResolvedValue({ run: true, bucket: 0, cycle: 1 });
  formCabinetMock.mockReset().mockResolvedValue({ ran: true, filled: 0, filledPositionIds: [] });
  caretakerMinistersMock.mockReset().mockResolvedValue({ ran: false, ordersIssued: 0 });
  timeline = [];
  inFlight = 0;
  peakInFlight = 0;
  ministerialMock.mockReset().mockImplementation(async (_db: unknown, countryId: string) => {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    timeline.push(`domestic:${countryId}`);
    return { ran: true, tiersSet: 0, ordersIssued: 0, reshuffled: 0 };
  });
  foreignPolicyMock.mockReset().mockImplementation(async (_db: unknown, countryId: string) => {
    timeline.push(`foreign:${countryId}`);
    return { ran: true, mode: "shadow", acted: false, decisionRecorded: true };
  });
});

describe("runNppGovernmentPhases", () => {
  it("runs domestic steps in bounded lanes, then foreign policy serially in country order", async () => {
    await runNppGovernmentPhases(now, 100);

    expect(ORDER.length).toBeGreaterThan(NPP_GOVERNMENT_LANES);
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(NPP_GOVERNMENT_LANES);
    const lastDomestic = timeline.findLastIndex((e) => e.startsWith("domestic:"));
    const firstForeign = timeline.findIndex((e) => e.startsWith("foreign:"));
    expect(lastDomestic).toBeLessThan(firstForeign);
    expect(foreignPolicyMock.mock.calls.map((c) => c[1])).toEqual(ORDER);
  });

  it("runs one country at a time below v6", async () => {
    levelMock.mockResolvedValueOnce("v5");
    await runNppGovernmentPhases(now, 100);

    expect(peakInFlight).toBe(1);
  });

  it("skips foreign policy for unregistered, unclaimed and player-enabled countries", async () => {
    const [registeredA, unclaimed, player, ...rest] = ORDER;
    registeredMock.mockResolvedValue([registeredA, unclaimed, player]);
    claimSlotMock.mockImplementation(async (_db: unknown, countryId: string) =>
      countryId === unclaimed
        ? { run: false, bucket: 0, cycle: 1, reason: "not-due" }
        : { run: true, bucket: 0, cycle: 1 }
    );
    enabledForPlayersMock.mockImplementation(async (_db: unknown, countryId: string) => {
      return countryId === player;
    });

    await runNppGovernmentPhases(now, 100);

    expect(rest.length).toBeGreaterThan(0);
    expect(foreignPolicyMock.mock.calls.map((c) => c[1])).toEqual([registeredA]);
  });

  it("on a failure, runs foreign policy only for countries ordered before it, then rethrows", async () => {
    const failing = ORDER[NPP_GOVERNMENT_LANES + 1]!;
    ministerialMock.mockImplementation(async (_db: unknown, countryId: string) => {
      if (countryId === failing) throw new Error("boom");
      return { ran: true, tiersSet: 0, ordersIssued: 0, reshuffled: 0 };
    });

    await expect(runNppGovernmentPhases(now, 100)).rejects.toThrow("boom");

    expect(foreignPolicyMock.mock.calls.map((c) => c[1])).toEqual(
      ORDER.slice(0, ORDER.indexOf(failing))
    );
    // No country is started after the failure beyond the lanes already in flight.
    expect(ministerialMock.mock.calls.length).toBeLessThan(ORDER.length);
  });
});
