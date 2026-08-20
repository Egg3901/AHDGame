import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/world/blocMembership", () => ({ loadBlocMembership: vi.fn() }));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn(),
}));

const db = {} as Db;

describe("resolveSeatDirection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getGameStatePresetOrDefault } = await import("@/lib/db/collections/gameState");
    vi.mocked(getGameStatePresetOrDefault).mockResolvedValue("1953-default");
  });

  it("pushes East for a Warsaw Pact member", async () => {
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({ DD: "east", US: "west" });
    const { resolveSeatDirection } = await import("./direction");
    await expect(resolveSeatDirection(db, "DD")).resolves.toBe(1);
  });

  it("pushes West for a NATO member", async () => {
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({ DD: "east", US: "west" });
    const { resolveSeatDirection } = await import("./direction");
    await expect(resolveSeatDirection(db, "US")).resolves.toBe(-1);
  });

  it("follows a defection rather than the seat's nominal side", async () => {
    // The whole point of reading live membership: a UK that has joined the
    // Warsaw Pact plays East, and nothing about it is hardcoded.
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({ UK: "east" });
    const { resolveSeatDirection } = await import("./direction");
    await expect(resolveSeatDirection(db, "UK")).resolves.toBe(1);
  });

  it("gives a non-aligned country no direction at all", async () => {
    // loadBlocMembership omits non-members entirely.
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({ US: "west" });
    const { resolveSeatDirection } = await import("./direction");
    await expect(resolveSeatDirection(db, "UK")).resolves.toBeNull();
  });

  it("treats an explicit nonAligned membership as no direction", async () => {
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({ UK: "nonAligned" });
    const { resolveSeatDirection } = await import("./direction");
    await expect(resolveSeatDirection(db, "UK")).resolves.toBeNull();
  });

  it("passes the world's preset through to the membership read", async () => {
    // Which organisations govern accession is era-dependent, so a wrong preset
    // silently returns the wrong bloc rather than failing.
    const { getGameStatePresetOrDefault } = await import("@/lib/db/collections/gameState");
    vi.mocked(getGameStatePresetOrDefault).mockResolvedValue("1979-default");
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({ US: "west" });
    const { resolveSeatDirection } = await import("./direction");
    await resolveSeatDirection(db, "US");
    expect(vi.mocked(loadBlocMembership)).toHaveBeenCalledWith(db, "1979-default");
  });
});

describe("resolveAllSeatDirections", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getGameStatePresetOrDefault } = await import("@/lib/db/collections/gameState");
    vi.mocked(getGameStatePresetOrDefault).mockResolvedValue("1953-default");
  });

  it("resolves every seat in one membership read", async () => {
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({
      US: "west",
      UK: "west",
      RU: "east",
      DD: "east",
    });
    const { resolveAllSeatDirections } = await import("./direction");
    await expect(resolveAllSeatDirections(db)).resolves.toEqual({
      US: -1,
      UK: -1,
      RU: 1,
      DD: 1,
    });
    expect(vi.mocked(loadBlocMembership)).toHaveBeenCalledTimes(1);
  });

  it("returns a null direction for every seat when nobody is in a bloc", async () => {
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({});
    const { resolveAllSeatDirections } = await import("./direction");
    await expect(resolveAllSeatDirections(db)).resolves.toEqual({
      US: null,
      UK: null,
      RU: null,
      DD: null,
    });
  });

  it("covers exactly the configured seats", async () => {
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({});
    const { SETTLEMENT_SEATS } = await import("@/lib/constants/settlementCrisis");
    const { resolveAllSeatDirections } = await import("./direction");
    const all = await resolveAllSeatDirections(db);
    expect(Object.keys(all).sort()).toEqual(SETTLEMENT_SEATS.map((s) => s.id).sort());
  });
});
