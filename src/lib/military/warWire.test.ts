import { describe, it, expect } from "vitest";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { PeaceTerm } from "./peaceTerm";
import { buildSettledDispatch, termFieldValue } from "./warWire";

function war(term: PeaceTerm | null, path: "dictated" | "negotiated" = "dictated"): ConflictDoc {
  return {
    _id: "w1",
    name: "The Anatolian War",
    ...(term
      ? {
          settlement: { term, path, imposedBy: "UK", target: "TR", turn: 400 },
        }
      : {}),
  } as unknown as ConflictDoc;
}

const INDEMNITY: PeaceTerm = { kind: "indemnity", payer: "TR", amount: 2400 };
const WHITE: PeaceTerm = { kind: "indemnity", payer: "TR", amount: 0 };
const REGIME: PeaceTerm = { kind: "regime_change", targetSystem: "presidential" };
const DEMIL: PeaceTerm = { kind: "demilitarisation", turns: 240 };
const WHITE_PEACE: PeaceTerm = { kind: "white_peace" };

const ALL = [war(INDEMNITY), war(WHITE), war(REGIME), war(DEMIL), war(WHITE_PEACE), war(null)];

describe("buildSettledDispatch: house style", () => {
  it("carries no digits in the prose, which is the desk style", () => {
    // The figures live in the fields, where they can be read at a glance instead of
    // parsed out of a sentence.
    for (const c of ALL) {
      expect(buildSettledDispatch(c).body).not.toMatch(/\d/);
    }
  });

  it("puts the figures in the fields instead", () => {
    const d = buildSettledDispatch(war(INDEMNITY));
    expect(JSON.stringify(d.embed.fields)).toContain("2,400");
  });

  it("names a desk in the footer, not the product", () => {
    const d = buildSettledDispatch(war(INDEMNITY));
    expect(d.embed.footer?.text).toBe("War Desk");
    expect(d.embed.footer?.text).not.toMatch(/House Divided/);
  });

  it("titles the post with what happened, not with the feature's name", () => {
    for (const c of ALL) {
      expect(buildSettledDispatch(c).title).not.toMatch(/peace term/i);
    }
  });

  it("uses no em dash, en dash, calendar year, or anchor unit", () => {
    for (const c of ALL) {
      const d = buildSettledDispatch(c);
      const text = `${d.title} ${d.body} ${JSON.stringify(d.embed)}`;
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/\b(19|20)\d\d\b/);
      expect(text).not.toContain("₳");
    }
  });

  it("says something in every state", () => {
    for (const c of ALL) {
      const d = buildSettledDispatch(c);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.body.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSettledDispatch: what each ending says", () => {
  it("names a regime change as a change of government", () => {
    const d = buildSettledDispatch(war(REGIME));
    expect(d.title).toMatch(/change its government/i);
    expect(d.body).toMatch(/go to the polls/i);
  });

  it("names a demilitarisation as a disarmament", () => {
    expect(buildSettledDispatch(war(DEMIL)).title).toMatch(/disarmed/i);
  });

  it("names an indemnity as a payment", () => {
    expect(buildSettledDispatch(war(INDEMNITY)).title).toMatch(/pays/i);
  });

  it("posts a white peace too, because a war ending is news either way", () => {
    const d = buildSettledDispatch(war(WHITE));
    expect(d.title).toMatch(/nothing taken/i);
    expect(JSON.stringify(d.embed.fields)).toContain("White peace");
  });

  it("reads a lapsed window as taking nothing, not as a missing record", () => {
    const d = buildSettledDispatch(war(null));
    expect(JSON.stringify(d.embed.fields)).toContain("None taken");
  });

  it("distinguishes a dictated settlement from a negotiated one", () => {
    expect(JSON.stringify(buildSettledDispatch(war(INDEMNITY, "dictated")).embed)).toContain(
      "Force of arms"
    );
    expect(JSON.stringify(buildSettledDispatch(war(INDEMNITY, "negotiated")).embed)).toContain(
      "Negotiation"
    );
  });
});

describe("termFieldValue", () => {
  it("names the payer of an indemnity, since it is quoted in their currency", () => {
    expect(termFieldValue(INDEMNITY)).toContain("Turkey");
  });

  it("states a demilitarisation in turns", () => {
    expect(termFieldValue(DEMIL)).toContain("240 turns");
  });
});

describe("buildSettledDispatch: a white peace", () => {
  it("names no victor in the outcome field, because none is recorded", () => {
    // An indemnity of zero still has a winner; a white peace does not, and the
    // dispatch must not credit one. Asserted on the FIELD rather than the whole
    // embed: the prose legitimately uses the word while negating it.
    const d = buildSettledDispatch(war(WHITE_PEACE));
    const outcome = d.embed.fields?.find((f) => f.name === "Outcome");
    expect(outcome?.value).toBe("The front line held");
    expect(outcome?.value).not.toMatch(/United Kingdom|Turkey/);
  });

  it("credits the winner on any other term, so the check above is not vacuous", () => {
    const d = buildSettledDispatch(war(INDEMNITY));
    const outcome = d.embed.fields?.find((f) => f.name === "Outcome");
    expect(outcome?.value).toMatch(/prevailed/);
  });

  it("says the question it was fought over is still open", () => {
    expect(buildSettledDispatch(war(WHITE_PEACE)).body).toMatch(/still there to be argued over/i);
  });

  it("titles it as ending where it began", () => {
    expect(buildSettledDispatch(war(WHITE_PEACE)).title).toMatch(/ends where it began/i);
  });

  it("labels the term as a status quo", () => {
    expect(termFieldValue(WHITE_PEACE)).toMatch(/status quo/i);
  });
});
