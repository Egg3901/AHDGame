import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import {
  HUNDREDTHS,
  swingBand,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_WIRE_INTERVAL_TURNS,
} from "@/lib/constants/settlementCrisis";
import { briefingIsDue, buildBriefing, buildEventDispatch } from "./wire";

function crisis(over: Partial<SettlementCrisisDoc> = {}): SettlementCrisisDoc {
  return {
    _id: new ObjectId(),
    kind: "settlement.germanQuestion",
    status: "open",
    targetEntityId: "DE",
    challengerEntityId: "DD",
    position: 47 * HUNDREDTHS,
    institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({
      id: i.id,
      weight: i.weight,
      position: i.opening,
      lastPlay: null,
      lastDrift: 0,
    })),
    seats: [],
    ladder: { heat: 0, armedTurn: null },
    driftHistory: [],
    lastTickedTurn: 411,
    conflictId: null,
    openedTurn: 400,
    resolvedTurn: null,
    outcome: null,
    cooldownUntilTurn: null,
    createdAt: new Date("1953-01-01T00:00:00Z"),
    updatedAt: new Date("1953-01-01T00:00:00Z"),
    ...over,
  } as SettlementCrisisDoc;
}

describe("briefingIsDue", () => {
  it("waits the full interval after the last dispatch", () => {
    const doc = crisis({ lastBriefing: { turn: 400, position: 3820 } });
    expect(briefingIsDue(doc, 400 + SETTLEMENT_WIRE_INTERVAL_TURNS - 1)).toBe(false);
    expect(briefingIsDue(doc, 400 + SETTLEMENT_WIRE_INTERVAL_TURNS)).toBe(true);
  });

  it("counts from the opening turn when nothing has been filed yet", () => {
    // A document written before the stamp existed must not fire a briefing on
    // its very next tick.
    const doc = crisis({ openedTurn: 500, lastBriefing: undefined });
    expect(briefingIsDue(doc, 501)).toBe(false);
    expect(briefingIsDue(doc, 500 + SETTLEMENT_WIRE_INTERVAL_TURNS)).toBe(true);
  });
});

describe("buildBriefing", () => {
  function fieldOf(embed: { fields?: { name: string; value: string }[] }, name: string) {
    return embed.fields?.find((f) => f.name === name)?.value;
  }

  it("reports the swing against the last dispatch, not against nothing", () => {
    const doc = crisis({
      position: 52 * HUNDREDTHS,
      lastBriefing: { turn: 400, position: 44 * HUNDREDTHS },
    });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 12 });
    expect(fieldOf(embed, "Settlement")).toBe("52.0 reunification / 48.0 sovereignty");
    expect(fieldOf(embed, "Swing")).toBe("+8.00 since the last dispatch");
  });

  it("titles the post with what happened, not with the feature's name", () => {
    // The desk style: "Washington deepens its commitment in Vietnam" is a
    // sentence about the world. A recurring post titled with the crisis's own
    // name reads as a status widget and gets skimmed.
    const swungEast = crisis({
      position: 52 * HUNDREDTHS,
      lastBriefing: { turn: 400, position: 44 * HUNDREDTHS },
    });
    expect(buildBriefing({ crisis: swungEast, currentTurn: 406, publicVoices: 0 }).title).toBe(
      "Bonn swings east"
    );

    const swungWest = crisis({
      position: 30 * HUNDREDTHS,
      lastBriefing: { turn: 400, position: 44 * HUNDREDTHS },
    });
    expect(buildBriefing({ crisis: swungWest, currentTurn: 406, publicVoices: 0 }).title).toBe(
      "Bonn swings west"
    );

    const flat = crisis({
      position: 44 * HUNDREDTHS,
      lastBriefing: { turn: 400, position: 44 * HUNDREDTHS },
    });
    expect(buildBriefing({ crisis: flat, currentTurn: 406, publicVoices: 0 }).title).toBe(
      "Bonn holds where it stood"
    );
  });

  it("keeps digits out of the prose — the figures live in the fields", () => {
    // Matching the Vietnam desk: two sentences you can read aloud, then a
    // couple of terse labelled fields.
    const doc = crisis({
      position: 52 * HUNDREDTHS,
      lastBriefing: { turn: 400, position: 44 * HUNDREDTHS },
    });
    const { body } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 12 });
    expect(body).not.toMatch(/\d/);
    expect(body).toContain("swung sharply toward reunification");
  });

  it("says so plainly when the board barely moved", () => {
    const doc = crisis({
      // Inside the "barely moved" band, expressed through the band itself:
      // the bands are tempo-scaled, so a frozen offset would fall out of them.
      position: 44 * HUNDREDTHS + Math.round(swingBand(0.4) * HUNDREDTHS),
      lastBriefing: { turn: 400, position: 44 * HUNDREDTHS },
    });
    const { body } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 0 });
    expect(body).toContain("barely moved");
  });

  it("names the direction correctly when sovereignty gains", () => {
    const doc = crisis({
      position: 30 * HUNDREDTHS,
      lastBriefing: { turn: 400, position: 44 * HUNDREDTHS },
    });
    const { body, embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 3 });
    expect(body).toContain("toward sovereignty");
    expect(fieldOf(embed, "Swing")).toBe("-14.00 since the last dispatch");
  });

  it("reports the public in AGGREGATE and never names an action", () => {
    // The whole reason this is a periodic briefing rather than an event feed.
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 1204 });
    expect(fieldOf(embed, "Open floor")).toContain("1,204");
    expect(JSON.stringify(embed)).not.toMatch(/op-ed|Rally Your Constituency|Open Letter/i);
  });

  it("says nobody spoke rather than printing a zero", () => {
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 0 });
    expect(fieldOf(embed, "Open floor")).toContain("Nobody took a public position");
  });

  it("lists every institution with its weight in one compact field", () => {
    // One field rather than four: the desk embeds are terse, and four
    // near-identical cards would swamp the two lines that carry the story.
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 0 });
    const board = fieldOf(embed, "The board") ?? "";
    for (const inst of SETTLEMENT_INSTITUTIONS) {
      expect(board, inst.id).toContain(`${inst.name} ×${inst.weight}`);
    }
    expect(board.split("\n")).toHaveLength(SETTLEMENT_INSTITUTIONS.length);
  });

  it("omits the rung entirely while the temperature is cold", () => {
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 0 });
    expect(fieldOf(embed, "Rung")).toBeUndefined();
  });

  it("carries the rung once it is hot, and goes red at the brink", () => {
    const hot = crisis({
      ladder: { heat: 5, armedTurn: 405 },
      lastBriefing: { turn: 400, position: 4700 },
    });
    const { embed } = buildBriefing({ crisis: hot, currentTurn: 406, publicVoices: 0 });
    expect(fieldOf(embed, "Rung")).toContain("DEFCON 1");
    expect(embed.color).toBe(0xed4245);
  });

  it("signs every dispatch with the desk, not with the product", () => {
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 0 });
    expect(embed.footer?.text).toBe("Bonn Desk");
  });

  it("carries no calendar year and no anchor-unit figure", () => {
    // Project-wide copy rules: the same text has to read correctly in every
    // era, and anchor units are not a player-facing currency.
    const doc = crisis({ lastBriefing: { turn: 400, position: 4400 } });
    const { body, embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 40 });
    const text = `${body} ${JSON.stringify(embed)}`;
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(text).not.toContain("₳");
  });
});

describe("buildEventDispatch", () => {
  function fieldOf(embed: { fields?: { name: string; value: string }[] }, name: string) {
    return embed.fields?.find((f) => f.name === name)?.value;
  }

  it("announces the opening without claiming an outcome", () => {
    const { title, embed } = buildEventDispatch("opened", crisis({ position: 3820 }));
    expect(title).toBe("The four powers reopen the German question");
    expect(fieldOf(embed, "Opening board")).toBe("38.2 reunification / 61.8 sovereignty");
  });

  it("describes the brink as a decision not yet taken", () => {
    const { body, embed } = buildEventDispatch(
      "armed",
      crisis({ ladder: { heat: 5, armedTurn: 1 } })
    );
    expect(body).toContain("Nothing has been declared");
    expect(fieldOf(embed, "Rung")).toContain("DEFCON 1");
    expect(embed.color).toBe(0xed4245);
  });

  it("says the war decides it, whatever the meter read", () => {
    const { body, embed } = buildEventDispatch("war", crisis({ status: "frozen" }));
    expect(body).toContain("whoever wins takes the settlement outright");
    expect(fieldOf(embed, "Frozen at")).toBeTruthy();
  });

  it("distinguishes the two settlements", () => {
    const east = buildEventDispatch("settled", crisis({ outcome: "challenger" }));
    expect(east.title).toContain("one country again");
    expect(east.body).toContain("dissolved");
    expect(fieldOf(east.embed, "Outcome")).toBe("Reunification");

    const west = buildEventDispatch("settled", crisis({ outcome: "incumbent" }));
    expect(west.title).toBe("Bonn keeps its sovereignty");
    expect(west.body).toContain("may ask again");
    expect(fieldOf(west.embed, "Outcome")).toBe("Sovereignty");
  });

  it("does not call a Western win permanent", () => {
    // It is the status quo holding, not a lock — the admin can reopen at will.
    const west = buildEventDispatch("settled", crisis({ outcome: "incumbent" }));
    expect(west.body).not.toMatch(/permanent(ly)? settled|forever|never again/i);
  });

  it("signs every one-off with the desk too", () => {
    for (const event of ["opened", "armed", "war", "settled"] as const) {
      const { embed } = buildEventDispatch(event, crisis({ outcome: "incumbent" }));
      expect(embed.footer?.text, event).toBe("Bonn Desk");
    }
  });
});
