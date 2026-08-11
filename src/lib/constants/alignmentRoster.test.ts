import { describe, expect, it } from "vitest";
import { COUNTRY_CONFIGS } from "./countries";
import {
  ALIGNMENT_ROSTER,
  ROSTER_BY_KEY,
  existsAt,
  isLiveCountryKey,
  statusAt,
  type AlignmentCountryKey,
} from "./alignmentRoster";

/** Manifest entity ids are plain strings; the roster is keyed by the union. */
const rostered = (entityId: string) => ROSTER_BY_KEY[entityId as AlignmentCountryKey];

// 197 from the ops report, plus UKR/BLR/BAL (Soviet union republics the report
// omits, now promoted to countries in their own right) and SCO/WAL
// (secession-gated CountryIds) = 200.
describe("ALIGNMENT_ROSTER", () => {
  it("carries all 200 entities with unique keys", () => {
    expect(ALIGNMENT_ROSTER).toHaveLength(200);
    const keys = ALIGNMENT_ROSTER.map((r) => r.key);
    expect(new Set(keys).size).toBe(200);
  });

  it("covers every implemented CountryId", () => {
    // The literal-union assertion in the module enforces this at compile time
    // too; this catches a roster entry whose key drifted from its CountryId.
    const missing = Object.keys(COUNTRY_CONFIGS).filter((id) => !(id in ROSTER_BY_KEY));
    expect(missing).toEqual([]);
  });

  // Dependencies with no single administering power. The manifest models these
  // as unparented and it is right to: in 1953 Trieste was split between Allied
  // and Yugoslav zones, Tangier was an international zone, and the Palestine
  // Mandate had already ended. Seeding falls through to the default lean for
  // them rather than inheriting an invented metropole's alignment.
  const UNPARENTED_DEPENDENCIES = new Set(["FTT", "TNG", "PS"]);

  it("gives every dependency a metropole and no sovereign one", () => {
    for (const r of ALIGNMENT_ROSTER) {
      if (r.status1953 !== "dependent") {
        expect(r.metro, r.key).toBeNull();
      } else if (UNPARENTED_DEPENDENCIES.has(r.key)) {
        expect(r.metro, r.key).toBeNull();
      } else {
        expect(r.metro, r.key).toBeTruthy();
      }
    }
  });

  it("points every metropole at another rostered entity", () => {
    for (const r of ALIGNMENT_ROSTER) {
      if (r.metro) expect(ROSTER_BY_KEY[r.metro], `${r.key} -> ${r.metro}`).toBeTruthy();
    }
  });

  it("splits into the ops report's three tiers", () => {
    const byTier = ALIGNMENT_ROSTER.reduce<Record<string, number>>((a, r) => {
      a[r.tier] = (a[r.tier] ?? 0) + 1;
      return a;
    }, {});
    // These two move together and the SUM never does — a tier change is always a
    // transfer between them, so a total that shifts means an entity was added or
    // lost rather than reclassified.
    //
    // Ireland joins Austria, Finland, and Greece as a promoted Tier 1 economy;
    // Spain remains demoted. The roster follows the manifest on tier, and this
    // pair of counts turns a silent upstream reclassification into a failing test.
    // Ukraine, Byelorussia and the Baltics run their own economies and chambers
    // now, so all three sit in full-autonomous: 23 + 3, with two of them moving
    // out of historical-presence and Ukraine added new.
    expect(byTier["full-autonomous"]).toBe(26);
    expect(byTier["sphere-macro"]).toBe(38);
    expect(byTier["historical-presence"]).toBe(136);
  });
});

describe("existsAt", () => {
  it("retires colonial entities at their successor's birth", () => {
    expect(existsAt("GC", 1953)).toBe(true); // Gold Coast
    expect(existsAt("GC", 1979)).toBe(false);
    expect(existsAt("GH", 1953)).toBe(false); // Ghana
    expect(existsAt("GH", 1979)).toBe(true);
  });

  it("retires French Algeria into Algeria in 1962", () => {
    expect(existsAt("FA", 1961)).toBe(true);
    expect(existsAt("FA", 1962)).toBe(false);
    expect(existsAt("DZ", 1961)).toBe(false);
    expect(existsAt("DZ", 1962)).toBe(true);
  });

  it("keeps a never-bounded entity present in every start", () => {
    for (const y of [1953, 1979, 1991, 2019, 2023]) expect(existsAt("US", y)).toBe(true);
  });

  it("counts the measured presence per start", () => {
    const count = (y: number) => ALIGNMENT_ROSTER.filter((r) => existsAt(r.key, y)).length;
    expect(count(1953)).toBe(192);
    expect(count(1979)).toBe(176);
    expect(count(1991)).toBe(173);
    expect(count(2019)).toBe(173);
    expect(count(2023)).toBe(173);
  });
});

describe("statusAt", () => {
  it("turns a dependency sovereign at independence", () => {
    expect(statusAt("KE", 1953)).toBe("dependent"); // Kenya
    expect(statusAt("KE", 1979)).toBe("sovereign");
  });

  it("treats an emergent entity as sovereign once it exists", () => {
    expect(statusAt("GH", 1979)).toBe("sovereign");
  });

  it("counts the measured dependency load per start", () => {
    const deps = (y: number) =>
      ALIGNMENT_ROSTER.filter((r) => existsAt(r.key, y) && statusAt(r.key, y) === "dependent")
        .length;
    expect(deps(1953)).toBe(100);
    expect(deps(1979)).toBe(27);
    // 20 before the union republics got independence years. Byelorussia and the
    // Baltics were reading as dependent in 2019, which was simply wrong: they
    // are sovereign from 1991, and Ukraine now says so too.
    expect(deps(2019)).toBe(18);
  });
});

describe("isLiveCountryKey", () => {
  it("is true only for implemented countries", () => {
    expect(isLiveCountryKey("US")).toBe(true);
    expect(isLiveCountryKey("YU")).toBe(true);
    expect(isLiveCountryKey("EG")).toBe(false); // rostered, not implemented
    expect(isLiveCountryKey("TANG")).toBe(false); // Tanganyika
  });
});

describe("roster provenance", () => {
  it("carries every entity the world manifest defines for 1953", async () => {
    const { getWorldEntityPresetManifest } = await import("@/lib/world/worldEntityManifest");
    const manifest = getWorldEntityPresetManifest("1953-default");
    const manifestIds = manifest.entries.map((e) => e.entityId);
    const missing = manifestIds.filter((id) => !(id in ROSTER_BY_KEY));
    expect(missing, "roster is missing manifest entities").toEqual([]);
  });

  it("adds exactly the two CountryIds the manifest omits", async () => {
    const { getWorldEntityPresetManifest } = await import("@/lib/world/worldEntityManifest");
    const manifest = getWorldEntityPresetManifest("1953-default");
    const manifestIds = new Set(manifest.entries.map((e) => e.entityId));
    const extras = ALIGNMENT_ROSTER.map((r) => r.key).filter((k) => !manifestIds.has(k));
    // SCO/WAL are secession-gated CountryIds and stay outside the manifest.
    // UKR/BLR/BAL used to sit here too, as union republics the manifest did not
    // model separately; they are now first-class entries in it.
    expect([...extras].sort()).toEqual(["SCO", "WAL"]);
  });

  it("agrees with the manifest on tier and status for every shared entity", async () => {
    const { getWorldEntityPresetManifest } = await import("@/lib/world/worldEntityManifest");
    const manifest = getWorldEntityPresetManifest("1953-default");
    for (const entry of manifest.entries) {
      const mine = rostered(entry.entityId);
      if (!mine) continue;
      expect(mine.tier, `${entry.entityId} tier`).toBe(entry.simulationTier);
      expect(mine.status1953, `${entry.entityId} status`).toBe(entry.status);
    }
  });

  it("takes its metropole from the manifest's administering power", async () => {
    const { getWorldEntityPresetManifest } = await import("@/lib/world/worldEntityManifest");
    const manifest = getWorldEntityPresetManifest("1953-default");
    for (const entry of manifest.entries) {
      const mine = rostered(entry.entityId);
      if (!mine) continue;
      // The manifest is authoritative here: it models condominiums and
      // international zones (which have no single metropole) correctly, where
      // authoring by hand guessed one.
      expect(mine.metro, `${entry.entityId} metro`).toBe(entry.parentEntityId ?? null);
    }
  });

  it("never contradicts the manifest's map geometry", async () => {
    const { getWorldEntityPresetManifest } = await import("@/lib/world/worldEntityManifest");
    const manifest = getWorldEntityPresetManifest("1953-default");
    for (const entry of manifest.entries) {
      const mine = rostered(entry.entityId);
      const theirs = entry.mapFeatureIds ?? [];
      if (!mine || theirs.length === 0) continue;
      // The two fill each other's gaps — the manifest omits geometry for
      // playable countries, the roster omitted it for some colonies — but
      // where both speak they must say the same thing.
      expect([...mine.iso].sort(), `${entry.entityId} geometry`).toEqual([...theirs].sort());
    }
  });
});
