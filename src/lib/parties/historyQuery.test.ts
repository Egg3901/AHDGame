import { describe, expect, it } from "vitest";
import { buildPartyTenures, type CurrentTenureInput, type PartyHistoryEntry } from "./historyQuery";

function entry(overrides: Partial<PartyHistoryEntry>): PartyHistoryEntry {
  return {
    reason: "join",
    oldPartyId: null,
    newPartyId: null,
    oldPartyCountryId: null,
    newPartyCountryId: null,
    oldPartyName: null,
    newPartyName: null,
    characterCountryId: null,
    date: new Date("2026-01-01T00:00:00Z"),
    turn: 1,
    synthetic: false,
    ...overrides,
  };
}

function current(overrides: Partial<CurrentTenureInput>): CurrentTenureInput {
  return {
    partyId: "independent",
    partyCountryId: "US",
    partyName: null,
    joinedAt: null,
    fallbackDate: new Date("2026-12-31T00:00:00Z"),
    ...overrides,
  };
}

describe("buildPartyTenures", () => {
  it("returns no tenures when character is independent and has no history", () => {
    const tenures = buildPartyTenures([], current({}));
    expect(tenures).toEqual([]);
  });

  it("returns a single ongoing tenure when only a join event exists", () => {
    const tenures = buildPartyTenures(
      [
        entry({
          reason: "join",
          newPartyId: "10",
          newPartyCountryId: "US",
          newPartyName: "Republican Party",
          date: new Date("2025-05-01T00:00:00Z"),
          turn: 100,
        }),
      ],
      current({
        partyId: "10",
        partyCountryId: "US",
        partyName: "Republican Party",
        joinedAt: new Date("2025-05-01T00:00:00Z"),
      })
    );

    expect(tenures).toHaveLength(1);
    expect(tenures[0]).toMatchObject({
      partyId: "10",
      partyName: "Republican Party",
      startKind: "joined",
      endKind: "present",
      endedAt: null,
    });
  });

  it("renders a leave -> Independent gap -> next-party join as three tenures", () => {
    const tenures = buildPartyTenures(
      [
        entry({
          reason: "join",
          newPartyId: "10",
          newPartyCountryId: "US",
          newPartyName: "Republican Party",
          date: new Date("2025-01-01T00:00:00Z"),
          turn: 100,
        }),
        entry({
          reason: "leave",
          oldPartyId: "10",
          oldPartyCountryId: "US",
          oldPartyName: "Republican Party",
          newPartyId: "independent",
          date: new Date("2025-06-01T00:00:00Z"),
          turn: 200,
        }),
        entry({
          reason: "join",
          oldPartyId: "independent",
          newPartyId: "20",
          newPartyCountryId: "US",
          newPartyName: "Democratic Party",
          date: new Date("2025-12-01T00:00:00Z"),
          turn: 300,
        }),
      ],
      current({
        partyId: "20",
        partyCountryId: "US",
        partyName: "Democratic Party",
        joinedAt: new Date("2025-12-01T00:00:00Z"),
      })
    );

    expect(tenures.map((t) => [t.partyName, t.startKind, t.endKind])).toEqual([
      ["Republican Party", "joined", "left"],
      [null, "became_independent", "switched_to"],
      ["Democratic Party", "switched_to", "present"],
    ]);
  });

  it("collapses same-turn leave+join into a single switched_to transition", () => {
    const tenures = buildPartyTenures(
      [
        entry({
          reason: "join",
          newPartyId: "10",
          newPartyCountryId: "US",
          newPartyName: "Republican Party",
          date: new Date("2025-01-01T00:00:00Z"),
          turn: 100,
        }),
        entry({
          reason: "leave",
          oldPartyId: "10",
          oldPartyCountryId: "US",
          oldPartyName: "Republican Party",
          newPartyId: "independent",
          date: new Date("2025-06-01T00:00:00Z"),
          turn: 500,
        }),
        entry({
          reason: "join",
          oldPartyId: "independent",
          newPartyId: "20",
          newPartyCountryId: "US",
          newPartyName: "Democratic Party",
          date: new Date("2025-06-01T00:00:00Z"),
          turn: 500,
        }),
      ],
      current({
        partyId: "20",
        partyCountryId: "US",
        partyName: "Democratic Party",
        joinedAt: new Date("2025-06-01T00:00:00Z"),
      })
    );

    expect(tenures.map((t) => [t.partyName, t.endKind])).toEqual([
      ["Republican Party", "switched_to"],
      ["Democratic Party", "present"],
    ]);
    expect(tenures[1].startKind).toBe("switched_to");
  });

  it("marks purged tenure end with endKind: purged", () => {
    const tenures = buildPartyTenures(
      [
        entry({
          reason: "join",
          newPartyId: "10",
          newPartyCountryId: "US",
          newPartyName: "Republican Party",
          date: new Date("2025-01-01T00:00:00Z"),
          turn: 100,
        }),
        entry({
          reason: "purge",
          oldPartyId: "10",
          oldPartyCountryId: "US",
          oldPartyName: "Republican Party",
          newPartyId: "independent",
          date: new Date("2025-09-01T00:00:00Z"),
          turn: 400,
        }),
      ],
      current({
        partyId: "independent",
        partyCountryId: "US",
        partyName: null,
        joinedAt: null,
      })
    );

    expect(tenures.map((t) => [t.partyName, t.endKind])).toEqual([
      ["Republican Party", "purged"],
      [null, "present"],
    ]);
  });

  it("uses startKind: founded for create_party events", () => {
    const tenures = buildPartyTenures(
      [
        entry({
          reason: "create_party",
          oldPartyId: null,
          newPartyId: "33",
          newPartyCountryId: "US",
          newPartyName: "Green Party",
          date: new Date("2025-03-01T00:00:00Z"),
          turn: 50,
        }),
      ],
      current({
        partyId: "33",
        partyCountryId: "US",
        partyName: "Green Party",
        joinedAt: new Date("2025-03-01T00:00:00Z"),
      })
    );

    expect(tenures).toHaveLength(1);
    expect(tenures[0].startKind).toBe("founded");
  });

  it("appends a synthetic tail transition when running party != current party", () => {
    const tenures = buildPartyTenures(
      [
        entry({
          reason: "join",
          newPartyId: "10",
          newPartyCountryId: "US",
          newPartyName: "Republican Party",
          date: new Date("2025-01-01T00:00:00Z"),
          turn: 100,
        }),
      ],
      current({
        partyId: "20",
        partyCountryId: "US",
        partyName: "Democratic Party",
        joinedAt: new Date("2025-08-01T00:00:00Z"),
      })
    );

    expect(tenures).toHaveLength(2);
    expect(tenures[0].endKind).toBe("switched_to");
    expect(tenures[0].endSynthetic).toBe(true);
    expect(tenures[1]).toMatchObject({
      partyId: "20",
      partyName: "Democratic Party",
      startKind: "switched_to",
      startSynthetic: true,
      endKind: "present",
    });
  });

  it("collapses a duplicate join to the same already-running party (defensive)", () => {
    const tenures = buildPartyTenures(
      [
        entry({
          reason: "join",
          newPartyId: "10",
          newPartyCountryId: "US",
          newPartyName: "Republican Party",
          date: new Date("2025-01-01T00:00:00Z"),
          turn: 100,
        }),
        // Anomalous duplicate join to same party — should be ignored, not
        // produce two back-to-back Republican tenures with a fake switch.
        entry({
          reason: "join",
          oldPartyId: "10",
          newPartyId: "10",
          newPartyCountryId: "US",
          newPartyName: "Republican Party",
          date: new Date("2025-02-01T00:00:00Z"),
          turn: 110,
        }),
      ],
      current({
        partyId: "10",
        partyCountryId: "US",
        partyName: "Republican Party",
        joinedAt: new Date("2025-01-01T00:00:00Z"),
      })
    );

    expect(tenures).toHaveLength(1);
    expect(tenures[0]).toMatchObject({
      partyId: "10",
      startKind: "joined",
      endKind: "present",
    });
  });

  it("emits a single synthetic join when current state implies a party with no events", () => {
    const tenures = buildPartyTenures(
      [],
      current({
        partyId: "10",
        partyCountryId: "US",
        partyName: "Republican Party",
        joinedAt: new Date("2025-05-01T00:00:00Z"),
      })
    );

    expect(tenures).toHaveLength(1);
    expect(tenures[0]).toMatchObject({
      partyId: "10",
      startKind: "joined",
      startSynthetic: true,
      endKind: "present",
    });
    expect(tenures[0].startedAt.toISOString()).toBe("2025-05-01T00:00:00.000Z");
  });
});
