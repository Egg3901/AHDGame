import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadOffensiveOptInSources, offensiveOptInsAtFront } from "../offensiveOptIns";

const conflict: Pick<ConflictDoc, "sideA" | "sideB"> = {
  sideA: { label: "Allies", countries: ["US", "UK"] as CountryId[], kind: "coalition" },
  sideB: { label: "Gov't", countries: ["CN"] as CountryId[], kind: "state" },
};

function sources(
  theaterStates: Array<Record<string, unknown>>,
  nppAutoJoiners: string[] = []
): Parameters<typeof offensiveOptInsAtFront>[0] {
  return {
    theaterStates: theaterStates as never,
    nppAutoJoiners: new Set(nppAutoJoiners),
  };
}

describe("offensiveOptInsAtFront", () => {
  it("takes a standing order only for the front it names", () => {
    const state = [{ countryId: "UK", cohesion: 85, committed: {}, autoJoin: { afghan: true } }];
    expect([...offensiveOptInsAtFront(sources(state), conflict, "afghan")]).toEqual(["UK"]);
    expect([...offensiveOptInsAtFront(sources(state), conflict, "korea")]).toEqual([]);
  });

  it("opts in an NPP belligerent on every front it is rostered for", () => {
    expect([...offensiveOptInsAtFront(sources([], ["UK"]), conflict, "afghan")]).toEqual(["UK"]);
  });

  it("narrows the NPP set to the conflict's own belligerents", () => {
    // The reason the narrowing exists. `sideOf` is the PERMISSIVE resolver: it places
    // an unrostered country by its bloc's backer, so a blanket opt-in would enrol a
    // bloc member that merely had units parked at the theatre into attacking a war it
    // never entered. A player opting in one front at a time can never reach that.
    const optedIn = offensiveOptInsAtFront(sources([], ["FR", "UK"]), conflict, "afghan");
    expect([...optedIn]).toEqual(["UK"]);
  });

  it("still honours a player standing order from a country off the roster", () => {
    // The narrowing applies to the blanket set only. A standing order names its front
    // deliberately, and `sideOf`'s bloc placement for such a player is long-standing
    // behaviour this switch does not get to change.
    const state = [{ countryId: "FR", cohesion: 85, committed: {}, autoJoin: { afghan: true } }];
    expect([...offensiveOptInsAtFront(sources(state), conflict, "afghan")]).toEqual(["FR"]);
  });

  it("unions the two sources without duplicating a country in both", () => {
    const state = [{ countryId: "UK", cohesion: 85, committed: {}, autoJoin: { afghan: true } }];
    expect([...offensiveOptInsAtFront(sources(state, ["UK"]), conflict, "afghan")]).toEqual(["UK"]);
  });
});

describe("loadOffensiveOptInSources", () => {
  function db(gameState: Record<string, unknown> | null, countryRows: unknown[] = []): MockDb {
    const mock = createMockDb();
    mock.collection("theaterState").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    mock.collection("gameState").findOne.mockResolvedValue(gameState);
    mock.collection("countryGameStates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(countryRows),
    });
    return mock;
  }

  it("reads no country access at all while the switch is off", async () => {
    // The cost argument for the early exit: a world that never enabled this pays one
    // projected gameState read per tick and nothing else.
    const mock = db({ _id: "current" });
    const out = await loadOffensiveOptInSources(mock as unknown as Db);

    expect(out.nppAutoJoiners.size).toBe(0);
    expect(mock.collectionMocks.countryGameStates.find).not.toHaveBeenCalled();
  });

  it("collects every non-player-enabled country when the switch is on", async () => {
    const mock = db({ _id: "current", nppOffensiveJoinEnabled: true }, [
      { _id: "UK", status: "active", enabledForPlayers: false },
      { _id: "US", status: "active", enabledForPlayers: true },
    ]);
    const out = await loadOffensiveOptInSources(mock as unknown as Db);

    expect(out.nppAutoJoiners.has("UK")).toBe(true);
    expect(out.nppAutoJoiners.has("US")).toBe(false);
  });

  it("treats a missing gameState row as off", async () => {
    // Fail-closed: an unconfigured world must not send NPP armies on the attack.
    const out = await loadOffensiveOptInSources(db(null) as unknown as Db);
    expect(out.nppAutoJoiners.size).toBe(0);
  });
});
