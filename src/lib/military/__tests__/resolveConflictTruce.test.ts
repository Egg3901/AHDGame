import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolveConflict } from "../resolveConflict";

const recordTruceSpy = vi.fn();

vi.mock("@/lib/military/leaveConflict", () => ({
  standDownCountry: () => Promise.resolve(),
}));
vi.mock("@/lib/military/truce", () => ({
  recordTruce: (...a: unknown[]) => {
    recordTruceSpy(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/db/collections/conflicts", () => ({
  getConflictsCollection: () => ({ updateOne: () => Promise.resolve({ modifiedCount: 1 }) }),
}));

const db = {} as Db;
const conflict = {
  _id: "t1",
  hostCountry: "CN",
  sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition" },
  sideB: { label: "East", countries: ["CN", "RU"], kind: "coalition" },
} as unknown as ConflictDoc;

const pairs = () => recordTruceSpy.mock.calls.map((c) => [c[1], c[2]].sort().join("__")).sort();

beforeEach(() => vi.clearAllMocks());

describe("truces when a war resolves outright", () => {
  it("truces every cross-side pair, not just the principals", async () => {
    // An ally who did the fighting would otherwise be free to re-declare
    // immediately while the principal could not.
    await resolveConflict(db, conflict, "A", 40);
    expect(pairs()).toEqual(["CN__UK", "CN__US", "RU__UK", "RU__US"]);
  });

  it("does not truce two countries who fought on the SAME side", async () => {
    await resolveConflict(db, conflict, "A", 40);
    expect(pairs()).not.toContain("UK__US");
    expect(pairs()).not.toContain("CN__RU");
  });

  it("dates the truce from the turn the war ended", async () => {
    await resolveConflict(db, conflict, "A", 40);
    expect(recordTruceSpy.mock.calls.every((c) => c[3] === 40)).toBe(true);
  });

  it("truces the pair when a plain two-country war ends", async () => {
    const duel = {
      ...conflict,
      sideA: { label: "US", countries: ["US"], kind: "state" },
      sideB: { label: "CN", countries: ["CN"], kind: "state" },
    } as unknown as ConflictDoc;
    await resolveConflict(db, duel, "A", 40);
    expect(pairs()).toEqual(["CN__US"]);
  });

  it("writes no truce when one side is a generated force with no countries", async () => {
    // Nothing to truce with: an insurgency has no government to hold to it.
    const rebels = {
      ...conflict,
      sideB: { label: "Insurgents", countries: [], kind: "generated" },
    } as unknown as ConflictDoc;
    await resolveConflict(db, rebels, "A", 40);
    expect(recordTruceSpy).not.toHaveBeenCalled();
  });
});
