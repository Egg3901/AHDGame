import { describe, it, expect } from "vitest";
import { toBattleReportView } from "./battleReportView";
import type { BattleReportDoc } from "@/lib/db/types/battleReport";

const u = (id: string, country: string, casualties: number) => ({
  id,
  name: id,
  country,
  role: "line",
  dom: "ground",
  type: "Rifle Division",
  casualties,
  readiness: 50,
  materiel: 0,
  xp: 4,
  promo: false,
});

/** The live T420 report: DD led, RU joined the offensive, US defended. */
function coalitionReport(over: Record<string, unknown> = {}): BattleReportDoc {
  return {
    _id: "rc",
    theaterId: "front-1",
    declarerCountry: "DD",
    targetCountry: "US",
    attackers: ["DD", "RU"],
    defenders: ["US"],
    turn: 420,
    result: {
      theaterId: "front-1",
      theaterName: "Front",
      verdict: "Victory",
      win: true,
      margin: 20,
      rounds: [],
      retreat: null,
      attacker: {
        country: "DD",
        power: 5000,
        loss: 16299,
        unitResults: [u("d1", "DD", 5360), u("r1", "RU", 10939)],
        contingents: [
          { country: "DD", power: 1650, loss: 5360 },
          { country: "RU", power: 3350, loss: 10939 },
        ],
      },
      defender: {
        country: "US",
        power: 2000,
        loss: 2313,
        unitResults: [u("a1", "US", 2313)],
        contingents: [{ country: "US", power: 2000, loss: 2313 }],
      },
    },
    ...over,
  } as unknown as BattleReportDoc;
}

const view = (country: string, r = coalitionReport()) =>
  toBattleReportView(r, country, "Front", null);

describe("toBattleReportView — coalition perspective", () => {
  it("reads the offensive as offensive for the ALLY, not just the principal", () => {
    // RU is neither declarer nor target. Keying the perspective off `declarerCountry`
    // put RU on the defending side of a battle it attacked in: it was shown losing a
    // battle its coalition won, with the enemy's casualties as its own.
    const v = view("RU");
    expect(v.role).toBe("offensive");
    expect(v.win).toBe(true);
    expect(v.enemyCountry).toBe("US");
  });

  it("quotes the ally its OWN dead, not the coalition's total", () => {
    expect(view("RU").ownLoss).toBe(10939);
    expect(view("DD").ownLoss).toBe(5360);
    // The bug: every attacker was quoted the whole side's 16,299.
    expect(view("RU").ownLoss).not.toBe(16299);
  });

  it("still quotes the whole enemy side's dead as the enemy loss", () => {
    expect(view("RU").enemyLoss).toBe(2313);
    expect(view("US").enemyLoss).toBe(16299);
  });

  it("reads the same report as defensive for the defender", () => {
    const v = view("US");
    expect(v.role).toBe("defensive");
    expect(v.win).toBe(false);
    expect(v.ownLoss).toBe(2313);
    expect(v.enemyCountry).toBe("DD");
  });

  it("attributes a retreat to whichever side the viewer is actually on", () => {
    const r = coalitionReport();
    (r.result as unknown as Record<string, unknown>).retreat = { side: "attacker", round: 3 };
    expect(toBattleReportView(r, "RU", "Front", null).retreat).toBe("own");
    expect(toBattleReportView(r, "US", "Front", null).retreat).toBe("enemy");
  });

  it("falls back to the principals on a pre-coalition report", () => {
    const legacy = coalitionReport();
    delete (legacy as unknown as Record<string, unknown>).attackers;
    delete (legacy as unknown as Record<string, unknown>).defenders;
    delete (legacy.result!.attacker as unknown as Record<string, unknown>).contingents;
    delete (legacy.result!.defender as unknown as Record<string, unknown>).contingents;
    const v = toBattleReportView(legacy, "DD", "Front", null);
    expect(v.role).toBe("offensive");
    expect(v.ownLoss).toBe(16299);
    expect(v.enemyCountry).toBe("US");
  });

  it("keeps a no-contact report on the right side for an ally", () => {
    const nc = coalitionReport({ result: null, unopposedAdvance: true });
    const v = toBattleReportView(nc, "RU", "Front", 4.2);
    expect(v.noContact).toBe(true);
    expect(v.role).toBe("offensive");
    expect(v.verdict).toBe("Unopposed advance");
    expect(v.groundPct).toBe(4.2);
  });
});
