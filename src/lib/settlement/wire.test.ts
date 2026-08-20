import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import {
  HUNDREDTHS,
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
  it("reports the swing against the last dispatch, not against nothing", () => {
    const doc = crisis({
      position: 52 * HUNDREDTHS,
      lastBriefing: { turn: 400, position: 44 * HUNDREDTHS },
    });
    const { body } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 12 });
    expect(body).toContain("52.0");
    expect(body).toContain("48.0");
    expect(body).toContain("+8.0");
    expect(body).toContain("swung sharply toward reunification");
  });

  it("says so plainly when the board barely moved", () => {
    const doc = crisis({
      position: 44 * HUNDREDTHS + 20,
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
    const { body } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 3 });
    expect(body).toContain("toward sovereignty");
    expect(body).toContain("-14.0");
  });

  it("reports the public in AGGREGATE and never names an action", () => {
    // The whole reason this is a periodic briefing rather than an event feed.
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 1204 });
    const floor = embed.fields?.find((f) => f.name === "The open floor");
    expect(floor?.value).toContain("1,204");
    expect(JSON.stringify(embed)).not.toMatch(/op-ed|Rally Your Constituency|Open Letter/i);
  });

  it("says nobody spoke rather than printing a zero", () => {
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 0 });
    const floor = embed.fields?.find((f) => f.name === "The open floor");
    expect(floor?.value).toContain("No private citizen");
  });

  it("gives every institution its own field, with its weight", () => {
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 0 });
    for (const inst of SETTLEMENT_INSTITUTIONS) {
      expect(embed.fields?.some((f) => f.name.startsWith(inst.name))).toBe(true);
    }
  });

  it("omits the ladder entirely while the temperature is cold", () => {
    const doc = crisis({ lastBriefing: { turn: 400, position: 4700 } });
    const { embed } = buildBriefing({ crisis: doc, currentTurn: 406, publicVoices: 0 });
    expect(embed.fields?.some((f) => f.name.startsWith("Escalation"))).toBe(false);
  });

  it("leads with the ladder once it is hot, and goes red at the brink", () => {
    const hot = crisis({
      ladder: { heat: 5, armedTurn: 405 },
      lastBriefing: { turn: 400, position: 4700 },
    });
    const { embed } = buildBriefing({ crisis: hot, currentTurn: 406, publicVoices: 0 });
    const rung = embed.fields?.find((f) => f.name.startsWith("Escalation"));
    expect(rung?.name).toContain("DEFCON 1");
    expect(embed.color).toBe(0xed4245);
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
  it("announces the opening without claiming an outcome", () => {
    const { title, body } = buildEventDispatch("opened", crisis({ position: 3820 }));
    expect(title).toContain("open");
    expect(body).toContain("38.2");
  });

  it("describes the brink as a decision not yet taken", () => {
    const { body, embed } = buildEventDispatch(
      "armed",
      crisis({ ladder: { heat: 5, armedTurn: 1 } })
    );
    expect(body).toContain("Nothing has been declared");
    expect(embed.color).toBe(0xed4245);
  });

  it("says the war decides it, whatever the meter read", () => {
    const { body } = buildEventDispatch("war", crisis({ status: "frozen" }));
    expect(body).toContain("whoever wins the war");
  });

  it("distinguishes the two settlements", () => {
    const east = buildEventDispatch("settled", crisis({ outcome: "challenger" }));
    expect(east.title).toContain("one country again");
    expect(east.body).toContain("dissolved");

    const west = buildEventDispatch("settled", crisis({ outcome: "incumbent" }));
    expect(west.title).toBe("Bonn stands");
    expect(west.body).toContain("may ask again");
  });

  it("does not call a Western win permanent", () => {
    // It is the status quo holding, not a lock — the admin can reopen at will.
    const west = buildEventDispatch("settled", crisis({ outcome: "incumbent" }));
    expect(west.body).not.toMatch(/permanent(ly)? settled|forever|never again/i);
  });
});
