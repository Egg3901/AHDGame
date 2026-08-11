/**
 * Anachronism lint for PREE event copy.
 *
 * PREE definitions already carry `minYear` / `maxYear`, and the bulk of the
 * internet/podcast/viral events were swept into windows in an earlier pass —
 * measuring found exactly one straggler, not the ~44 the plan estimated. This
 * test is what keeps it at zero.
 *
 * The rule: a definition whose copy names a technology that did not exist in
 * 1953 must declare a `minYear`. Either window the event, or write the copy so
 * it reads in any era. `pree.localInterview` took the second route — a local
 * interview request is era-valid, and only its "Email a statement" option
 * label was modern.
 */
import { describe, expect, it } from "vitest";
import { PREE_SEED_DEFINITIONS } from "./seedDefinitions";
import { GLOBAL_SEED_DEFINITIONS_PART1 } from "./globalSeedDefinitions1";

/** Technology that postdates the earliest playable era (1953). */
const ANACHRONISM_PATTERNS: Array<[string, RegExp]> = [
  ["podcast", /\bpodcasts?\b/i],
  ["viral", /\bviral\b/i],
  ["social media", /social media|twitter|facebook|instagram|tiktok/i],
  ["internet/online", /\binternet\b|\bonline\b|\bwebsites?\b/i],
  ["streaming", /\bstreaming\b/i],
  ["smartphone/app", /\bsmartphones?\b|\bapps?\b/i],
  ["email", /\bemails?\b/i],
];

type Def = Record<string, unknown>;

const ALL_DEFS: Def[] = (() => {
  const seen = new Set<string>();
  const out: Def[] = [];
  for (const d of [
    ...(PREE_SEED_DEFINITIONS as unknown as Def[]),
    ...(GLOBAL_SEED_DEFINITIONS_PART1 as unknown as Def[]),
  ]) {
    const kind = String(d.kind);
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push(d);
  }
  return out;
})();

describe("PREE anachronism lint", () => {
  it("every definition naming modern technology declares a minYear", () => {
    const offenders = ALL_DEFS.filter((d) => {
      if (d.minYear != null) return false;
      const text = JSON.stringify(d);
      return ANACHRONISM_PATTERNS.some(([, re]) => re.test(text));
    }).map((d) => {
      const text = JSON.stringify(d);
      const hits = ANACHRONISM_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
      return `${String(d.kind)} (${hits.join(", ")})`;
    });

    expect(
      offenders,
      "Either give the event a minYear, or rewrite the copy so it reads in 1953 " +
        "as well as today. A 1953 world must not be offered an email or a podcast."
    ).toEqual([]);
  });

  it("is non-vacuous — the patterns match windowed events that legitimately use them", () => {
    // If this ever hits zero the patterns have stopped matching anything and
    // the test above would pass for the wrong reason.
    const windowedWithModernTerms = ALL_DEFS.filter(
      (d) => d.minYear != null && ANACHRONISM_PATTERNS.some(([, re]) => re.test(JSON.stringify(d)))
    );
    expect(windowedWithModernTerms.length).toBeGreaterThan(0);
  });

  it("declared windows are coherent", () => {
    for (const d of ALL_DEFS) {
      const min = d.minYear as number | undefined;
      const max = d.maxYear as number | undefined;
      if (min != null) {
        expect(min, `${String(d.kind)} minYear`).toBeGreaterThan(1900);
        expect(min, `${String(d.kind)} minYear`).toBeLessThan(2100);
      }
      if (min != null && max != null) {
        expect(max, `${String(d.kind)} maxYear`).toBeGreaterThanOrEqual(min);
      }
    }
  });
});
