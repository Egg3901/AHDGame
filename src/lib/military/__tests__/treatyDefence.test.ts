import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { resolveTreatyDefenders } from "../treatyDefence";

const gameStateSpy = vi.fn();
const isMemberSpy = vi.fn();
const votingMembersSpy = vi.fn();

vi.mock("@/lib/db/collections", () => ({
  getGameStateCollection: () => Promise.resolve({ findOne: () => gameStateSpy() }),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  isMember: (...a: unknown[]) => isMemberSpy(...a),
}));
vi.mock("@/lib/internationalOrganizations/orgMembership", () => ({
  votingMembers: (...a: unknown[]) => votingMembersSpy(...a),
}));

function db(): Db {
  return {} as unknown as Db;
}

beforeEach(() => {
  vi.clearAllMocks();
  gameStateSpy.mockResolvedValue({ conflictsEnabled: true, preset: "1953-default" });
  // Defender DD is in the Warsaw Pact and nothing else.
  isMemberSpy.mockImplementation((_db: Db, orgId: string) =>
    Promise.resolve(orgId === "WARSAW_PACT")
  );
  votingMembersSpy.mockResolvedValue(["RU", "DD"]);
});

describe("resolveTreatyDefenders", () => {
  it("pulls in the defender's bloc mates, excluding the defender itself", async () => {
    const out = await resolveTreatyDefenders(db(), { defender: "DD", declarer: "US" });
    expect(out).toEqual([{ countryId: "RU", organizationId: "WARSAW_PACT" }]);
  });

  it("never consults the aggressor's own alliance", async () => {
    await resolveTreatyDefenders(db(), { defender: "DD", declarer: "US" });
    // Membership is asked about the DEFENDER only. If this ever asks about the
    // declarer, an offensive war would drag the attacker's allies in too.
    for (const call of isMemberSpy.mock.calls) expect(call[2]).toBe("DD");
  });

  it("returns nothing when the defender belongs to no bloc alliance", async () => {
    isMemberSpy.mockResolvedValue(false);
    expect(await resolveTreatyDefenders(db(), { defender: "CN", declarer: "US" })).toEqual([]);
  });

  it("returns nothing when the conflicts subsystem is off", async () => {
    gameStateSpy.mockResolvedValue({ conflictsEnabled: false, preset: "1953-default" });
    expect(await resolveTreatyDefenders(db(), { defender: "DD", declarer: "US" })).toEqual([]);
  });

  // The bloc designation is keyed on the PRESET. A modern-era world has no bloc
  // alliances, so NATO is an ordinary security pact and guarantees nothing.
  it("returns nothing in a world whose preset carries no bloc designation", async () => {
    gameStateSpy.mockResolvedValue({ conflictsEnabled: true, preset: "2019-default" });
    expect(await resolveTreatyDefenders(db(), { defender: "DD", declarer: "US" })).toEqual([]);
  });

  it("returns nothing once the Cold War has been resolved in-game", async () => {
    gameStateSpy.mockResolvedValue({
      conflictsEnabled: true,
      preset: "1953-default",
      coldWarEndedTurn: 500,
    });
    expect(await resolveTreatyDefenders(db(), { defender: "DD", declarer: "US" })).toEqual([]);
  });

  it("excludes the declarer even if it somehow shares the alliance", async () => {
    votingMembersSpy.mockResolvedValue(["RU", "DD", "US"]);
    const out = await resolveTreatyDefenders(db(), { defender: "DD", declarer: "US" });
    expect(out.map((d) => d.countryId)).toEqual(["RU"]);
  });

  it("skips countries already on either roster of a live conflict", async () => {
    votingMembersSpy.mockResolvedValue(["RU", "DD", "PL"]);
    const out = await resolveTreatyDefenders(db(), {
      defender: "DD",
      declarer: "US",
      conflict: {
        sideA: { label: "A", countries: ["US"], kind: "state" },
        sideB: { label: "B", countries: ["DD", "RU"], kind: "coalition" },
      },
    });
    expect(out.map((d) => d.countryId)).toEqual(["PL"]);
  });
});
