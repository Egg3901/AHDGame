/**
 * Anachronism lint for legislation copy.
 *
 * A legislation type that is classified `"always"` shows up in a 1953 world.
 * That is usually right: media regulation, energy grids and public security are
 * not modern inventions, and the 1953 seed deliberately authors positions for
 * them ("Fairness Doctrine + AT&T monopoly in force"). What breaks immersion is
 * not the type, it is copy that names a technology which did not exist.
 *
 * So this does NOT gate types by keyword — an earlier pass at this program
 * proposed era-gating `us_media_communications` and friends, which would have
 * deleted correctly authored 1953 policy. It flags the COPY instead, and every
 * currently-tolerated case is listed below with a reason. A new `"always"` type
 * whose text names modern technology fails here and has to be a decision.
 */
import { describe, expect, it } from "vitest";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { LEGISLATION_ERA } from "./legislationCatalog";

/** Terms that name a technology or institution postdating the earliest era (1953). */
const ANACHRONISM_PATTERNS: Array<[string, RegExp]> = [
  ["net neutrality", /net neutrality/i],
  ["platform liability", /platform liability/i],
  ["social media", /social media/i],
  ["internet", /\binternet\b/i],
  ["broadband", /\bbroadband\b/i],
  ["cyber", /\bcyber/i],
  ["smartphone", /\bsmartphones?\b/i],
  ["streaming", /\bstreaming\b/i],
  ["AI", /\bartificial intelligence\b|\bA\.?I\.?\b/],
  ["e-commerce", /\be-commerce\b/i],
  ["podcast", /\bpodcasts?\b/i],
  ["website", /\bwebsites?\b/i],
  ["gig economy", /\bgig economy\b/i],
];

/**
 * Known `"always"` types whose copy names modern technology, with the reason
 * each is tolerated rather than gated. Shrinking this list is good; adding to
 * it should be a deliberate decision, which is the point of the test.
 */
const TOLERATED: Record<string, string> = {
  // Media regulation long predates the internet and the 1953 seed authors a
  // position for it. Only the illustrative examples in the copy are modern.
  us_media_communications: "type is era-valid; copy cites net neutrality as an example",
  // National grids are 1920s-era policy. "Broadband" is one clause of a long
  // infrastructure explanation.
  uk_energy_grid: "type is era-valid; broadband is one clause of the explanation",
  ie_rural_development: "type is era-valid; broadband appears in a list of modern schemes",
  ng_telecommunications: "telecoms policy is era-valid post-independence; copy is broadband-led",
  // Chinese-language policy copy naming real modern institutions
  // (网信办 / Cyberspace Administration) and current technology disputes.
  // Rewriting it is a content decision for a Chinese-reading owner, not a lint fix.
  cn_us_china_relations: "copy references current technology disputes",
  cn_public_security: "copy references modern surveillance technology",
  cn_press_freedom: "copy names the Cyberspace Administration, a real modern body",
};

function copyOf(t: Record<string, unknown>): string {
  const options = Array.isArray(t.options) ? (t.options as Array<Record<string, unknown>>) : [];
  return [
    t.name,
    t.description,
    t.explanation,
    ...options.flatMap((o) => [o.label, o.description, o.explanation]),
  ]
    .filter(Boolean)
    .join(" ");
}

describe("legislation anachronism lint", () => {
  const offenders = (legislationTypes as unknown as Array<Record<string, unknown>>)
    .map((t) => {
      const id = String(t._id);
      const era = (LEGISLATION_ERA as Record<string, unknown>)[id];
      const alwaysOn = era === undefined || era === "always";
      if (!alwaysOn) return null;
      const text = copyOf(t);
      const hits = ANACHRONISM_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
      return hits.length > 0 ? { id, hits } : null;
    })
    .filter((x): x is { id: string; hits: string[] } => x !== null);

  it("no NEW always-on legislation type carries anachronistic copy", () => {
    const unexpected = offenders.filter((o) => !(o.id in TOLERATED));
    expect(
      unexpected.map((o) => `${o.id} (${o.hits.join(", ")})`),
      "Either give the type an era window in LEGISLATION_ERA, or make the copy era-neutral. " +
        "If it is genuinely an era-valid type with one modern example in its text, add it to " +
        "TOLERATED with a reason."
    ).toEqual([]);
  });

  it("the tolerated list has no stale entries", () => {
    // If someone cleans up copy, the entry should be removed rather than left
    // to rot and quietly excuse a future regression on the same id.
    const offenderIds = new Set(offenders.map((o) => o.id));
    const stale = Object.keys(TOLERATED).filter((id) => !offenderIds.has(id));
    expect(stale, "these ids no longer trip the lint and can be removed").toEqual([]);
  });

  it("is non-vacuous — the patterns actually match something", () => {
    expect(offenders.length).toBeGreaterThan(0);
  });
});
