import { describe, it, expect } from "vitest";
import { validateColdWarConflict, type ColdWarConflictDraft } from "../validateCreateConflict";
import type { ConflictSide } from "@/lib/db/types/conflict";

const faction = (label: string, entity: string, backer: "west" | "east"): ConflictSide => ({
  label,
  countries: [],
  kind: "generated",
  backer,
  factionEntity: entity,
  tokenStrength: 40,
});

const ctx = {
  knownEntityIds: new Set(["NVN", "SVN", "KR", "KP"]),
  isCountryId: (id: string) => ["US", "UK", "RU", "DE"].includes(id),
};

const draft = (over: Partial<ColdWarConflictDraft> = {}): ColdWarConflictDraft => ({
  name: "Vietnam War",
  hostCountry: "SVN",
  hostEntities: ["NVN", "SVN"],
  sideA: faction("Republic of Vietnam", "SVN", "west"),
  sideB: faction("DRV", "NVN", "east"),
  ...over,
});

describe("validateColdWarConflict", () => {
  it("accepts a well-formed Vietnam draft", () => {
    expect(validateColdWarConflict(draft(), ctx)).toEqual({ ok: true });
  });

  it("refuses a host that is not in the world entity manifest", () => {
    // Anchor stays SVN and stays in the roster, so the anchor check passes and the
    // manifest check is the only thing that can refuse this.
    const r = validateColdWarConflict(draft({ hostEntities: ["SVN", "ZZZ"] }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ZZZ/);
  });

  it("refuses a host that is in the manifest but has no home region", () => {
    // The discriminating case: the entity EXISTS, so the manifest check passes and only
    // the region check can refuse it. Without that check buildConflict's "noa" fallback
    // files the war in North America with no error anywhere.
    const r = validateColdWarConflict(draft({ hostCountry: "ZQ", hostEntities: ["ZQ"] }), {
      ...ctx,
      knownEntityIds: new Set(["ZQ"]),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/home region/i);
  });

  it("refuses a factionEntity that collides with a real country", () => {
    // The fog resolver is safe only because no player country id can be a faction.
    const r = validateColdWarConflict(draft({ sideA: faction("Puppet", "US", "west") }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/US/);
  });

  it("refuses two sides backed by the same bloc", () => {
    const r = validateColdWarConflict(draft({ sideB: faction("DRV", "NVN", "west") }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/opposing blocs/i);
  });

  it("refuses an anchor that is not in the host roster", () => {
    const r = validateColdWarConflict(draft({ hostCountry: "KR" }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/anchor/i);
  });

  it("refuses a side with no faction entity", () => {
    const bare: ConflictSide = { label: "Nobody", countries: [], kind: "generated" };
    const r = validateColdWarConflict(draft({ sideA: bare }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/faction/i);
  });

  it("refuses an empty host roster", () => {
    const r = validateColdWarConflict(draft({ hostEntities: [] }), ctx);
    expect(r.ok).toBe(false);
  });

  it("refuses a blank name", () => {
    const r = validateColdWarConflict(draft({ name: "   " }), ctx);
    expect(r.ok).toBe(false);
  });
});
