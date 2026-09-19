import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import type { PoliticalParty } from "@/lib/db/types";
import { seedDDParties } from "./seedDD";
import { seedFRParties } from "./seedFR";
import { seedIEParties } from "./seedIE";
import { seedNGParties } from "./seedNG";
import { seedNIParties, seedUKParties } from "./seedUK";

/**
 * Every party seeder must PRUNE as well as FILTER.
 *
 * Filtering alone is a half-fix. It stops the wrong parties being written, and
 * leaves behind the ones a previous preset already wrote, because nothing goes
 * back and removes them. A test that seeds a fresh world passes regardless,
 * which is exactly why this survived: the leftovers are only visible after a
 * preset CHANGE, so every case below is a downgrade test, not a fresh-world one.
 *
 * Measured 2026-09-09: 15 seeders call `isPartyValidForPreset` and only 10 also
 * call `prunePresetMismatchedDefaultParties`. The five that filtered without
 * pruning were FR, IE, IT, NG and UK, and DD did neither - it destructured
 * `validForPresets` away and wrote every party unconditionally.
 *
 * ⚠️ Enumerated by EXPORTED FUNCTION, not by file or country code. `seedUK.ts`
 * holds two independent call sites - `seedUKParties` and `seedNIParties` - and
 * enumerating files would silently miss the second.
 */

interface SeederCase {
  name: string;
  /**
   * Runs the seeder under a preset. A closure rather than a bare function
   * reference because the seeders do not share a signature: `seedNIParties`
   * takes no preset and reads it from `gameState`, which is precisely the kind
   * of difference that would let a call site slip out of this table.
   */
  run: (db: Db, preset: string) => Promise<unknown>;
  module: () => Promise<PartySeed[]>;
  /** A preset whose roster includes parties the `to` preset excludes. */
  from: string;
  to: string;
  /** Restrict the stranded set when a seeder owns only part of a roster. */
  only?: (seed: PartySeed) => boolean;
}

const noop = () => {};

/** Point the in-memory world at a preset, for seeders that read gameState. */
async function setWorldPreset(db: Db, preset: string): Promise<void> {
  await db
    .collection("gameState")
    .updateOne({ _id: "current" as never }, { $set: { preset } }, { upsert: true });
}

const CASES: SeederCase[] = [
  {
    name: "seedUKParties",
    run: (db, preset) => seedUKParties(db, noop, preset),
    module: () => import("@/lib/seeds/uk/ukParties").then((m) => m.ukParties),
    from: "2019-default",
    to: "1953-default",
  },
  {
    name: "seedNIParties",
    run: async (db, preset) => {
      await setWorldPreset(db, preset);
      return seedNIParties(db, noop);
    },
    module: () => import("@/lib/seeds/uk/ukParties").then((m) => m.ukParties),
    from: "2019-default",
    to: "1953-default",
    // This seeder owns only the two Northern Irish parties.
    only: (seed) => seed.abbreviation === "DUP" || seed.abbreviation === "SF",
  },
  {
    name: "seedDDParties",
    run: (db, preset) => seedDDParties(db, noop, preset),
    module: () => import("@/lib/seeds/dd/ddParties").then((m) => m.ddParties),
    from: "1979-default",
    to: "1991-default",
  },
  {
    name: "seedFRParties",
    run: (db, preset) => seedFRParties(db, noop, preset),
    module: () => import("@/lib/seeds/fr/frParties").then((m) => m.frParties),
    // The French roster has no 2019-era parties at all, so 2019 -> 1953 would
    // strand nothing and prove nothing. The RPR/UDF/PS generation is tagged
    // 1979+1991 and the Front National 1991-only.
    from: "1991-default",
    to: "1953-default",
  },
  {
    name: "seedIEParties",
    run: (db, preset) => seedIEParties(db, noop, preset),
    module: () => import("@/lib/seeds/ie/ieParties").then((m) => m.ieParties),
    from: "2019-default",
    to: "1953-default",
  },
  // ⚠ ITALY CANNOT BE TESTED HERE, AND THE REASON IS WORTH KNOWING.
  // Every Italian party is tagged for all three Cold-War presets and none for a
  // modern one, so no DOWNGRADE strands anything -- all three eras want the same
  // five parties. The upgrade direction would, except that
  // `selectPartyRosterForPreset` inherits the 1991 roster for a preset with none
  // of its own, so the First Republic is re-seeded immediately after the prune
  // removes it. An assertion here would be testing the fallback, not the prune.
  //
  // That fallback is deliberate: without it Italy and France boot into modern
  // presets with ZERO parties, which `partyRosterCoverage.test.ts` forbids and
  // which breaks elections outright. The cost is that a 2019 Italian world seats
  // Democrazia Cristiana, dissolved in 1994. The fix is authoring modern Italian
  // and French rosters -- a data task. Restore this case when that lands.
  {
    name: "seedNGParties",
    run: (db, preset) => seedNGParties(db, noop, preset),
    module: () => import("@/lib/seeds/ng/ngParties").then((m) => m.ngParties),
    from: "2019-default",
    to: "1953-default",
  },
];

async function seededNames(db: Db): Promise<string[]> {
  const rows = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
  return rows.map((r) => r.name);
}

describe("party seeders prune the previous preset's parties", () => {
  it.each(CASES)(
    "$name drops what the new preset excludes",
    async ({ run, module, from, to, only }) => {
      const seeds = (await module()).filter((s) => only?.(s) ?? true);
      // Parties the `from` preset writes and the `to` preset must not keep.
      const stranded = seeds
        .filter((s) => s.validForPresets?.includes(from) && !s.validForPresets.includes(to))
        .map((s) => s.name);
      // If a roster stops era-tagging its parties this case proves nothing, so
      // fail loudly rather than passing vacuously.
      expect(stranded.length, "no era-tagged party to strand").toBeGreaterThan(0);

      const memory = createInMemoryDb();
      const db = memory as unknown as Db;

      await run(db, from);
      const afterFrom = await seededNames(db);
      expect(
        stranded.some((n) => afterFrom.includes(n)),
        `${from} should seed them`
      ).toBe(true);

      await run(db, to);
      const afterTo = await seededNames(db);
      for (const name of stranded) {
        expect(afterTo, `${name} survived the downgrade to ${to}`).not.toContain(name);
      }
    }
  );
});

describe("preset downgrades leave no stale party behind", () => {
  it("drops Reform UK when a 2019 world is reset to 1953", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    await seedUKParties(db, noop, "2019-default");
    expect(await seededNames(db)).toContain("Reform UK");
    await seedUKParties(db, noop, "1953-default");
    expect(await seededNames(db)).not.toContain("Reform UK");
  });

  it("writes no East German party into a world after reunification", async () => {
    // The headline case. `seedDDParties` used to destructure `validForPresets`
    // away entirely, so a 1991 or 2019 world was handed the SED and its bloc
    // parties whatever the era said.
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    await seedDDParties(db, noop, "1991-default");
    expect(await seededNames(db)).toEqual([]);
  });

  it("removes East German parties a Cold-War world had already written", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    await seedDDParties(db, noop, "1979-default");
    expect((await seededNames(db)).length).toBeGreaterThan(0);
    await seedDDParties(db, noop, "1991-default");
    expect(await seededNames(db)).toEqual([]);
  });
});
