import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { alliesOf, allianceBarBetween, loadAllianceRoll } from "../allianceBar";
import type { BlocLookup } from "../bloc";

const membershipSpy = vi.fn();
vi.mock("@/lib/world/blocMembership", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/world/blocMembership")>();
  return { ...real, loadBlocMembership: (...a: unknown[]) => membershipSpy(...a) };
});

const gameStateSpy = vi.fn();
vi.mock("@/lib/db/collections", () => ({
  getGameStateCollection: () => Promise.resolve({ findOne: () => gameStateSpy() }),
}));

const ROLL: BlocLookup = { US: "west", UK: "west", RU: "east", DD: "east" };

function db(): Db {
  return {} as unknown as Db;
}

beforeEach(() => {
  vi.clearAllMocks();
  membershipSpy.mockResolvedValue(ROLL);
  gameStateSpy.mockResolvedValue({ preset: "1953-default" });
});

describe("loadAllianceRoll", () => {
  it("reads the roll for the running preset", async () => {
    const roll = await loadAllianceRoll(db());
    expect(roll.preset).toBe("1953-default");
    expect(roll.blocs).toEqual(ROLL);
    expect(membershipSpy).toHaveBeenCalledWith(expect.anything(), "1953-default");
  });

  // The preset, not the live year: a 1953 world still has a Warsaw Pact in its year
  // 2050, and a year-derived read would lose the East the moment the clock passed 1991.
  it("falls back to the default preset when game state carries none", async () => {
    gameStateSpy.mockResolvedValue(null);
    const roll = await loadAllianceRoll(db());
    expect(roll.preset).toBeTruthy();
    expect(membershipSpy).toHaveBeenCalledWith(expect.anything(), roll.preset);
  });
});

describe("allianceBarBetween", () => {
  it("bars two members of the same alliance, naming it", async () => {
    expect(await allianceBarBetween(db(), "US", "UK")).toBe("North Atlantic Treaty Organization");
    expect(await allianceBarBetween(db(), "RU", "DD")).toBe("Warsaw Pact");
  });

  it("does not bar countries on opposite sides", async () => {
    expect(await allianceBarBetween(db(), "US", "RU")).toBeNull();
  });

  // The bug this fixes in miniature: before the gate existed, every one of these pairs
  // could file a declaration against the other.
  it("does not bar a non-aligned pair", async () => {
    expect(await allianceBarBetween(db(), "SE", "CN")).toBeNull();
    expect(await allianceBarBetween(db(), "US", "SE")).toBeNull();
  });

  // A modern preset has NATO but no eastern counterpart, so RU and CN read non-aligned.
  // If that counted as a shared bloc, no modern-era war could ever be declared.
  it("leaves an era with only one pole fully at war with itself", async () => {
    membershipSpy.mockResolvedValue({ US: "west", UK: "west" });
    gameStateSpy.mockResolvedValue({ preset: "2019-default" });
    expect(await allianceBarBetween(db(), "RU", "CN")).toBeNull();
    expect(await allianceBarBetween(db(), "US", "UK")).toBe("North Atlantic Treaty Organization");
  });

  // The bloc is the bar even where the era gives it no readable org name, so the
  // refusal still holds rather than silently lapsing into a permit.
  it("still bars when the bloc has no named org in that world", async () => {
    membershipSpy.mockResolvedValue({ RU: "east", DD: "east" });
    gameStateSpy.mockResolvedValue({ preset: "2019-default" });
    expect(await allianceBarBetween(db(), "RU", "DD")).toBe("same alliance bloc");
  });
});

describe("alliesOf", () => {
  it("lists a country's fellow members and the treaty binding them", async () => {
    const { alliance, mates } = alliesOf(await loadAllianceRoll(db()), "US");
    expect(alliance).toBe("North Atlantic Treaty Organization");
    expect(mates).toEqual(["UK"]);
  });

  it("never lists the country itself", async () => {
    const { mates } = alliesOf(await loadAllianceRoll(db()), "RU");
    expect(mates).toEqual(["DD"]);
  });

  it("gives a non-aligned country no allies and no alliance", async () => {
    const { alliance, mates } = alliesOf(await loadAllianceRoll(db()), "SE");
    expect(alliance).toBeNull();
    expect(mates).toEqual([]);
  });
});
