import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, sep } from "path";

/**
 * THE REVENUE-WRITER REGISTRY.
 *
 * Under `marketSystemMode >= "plants"` a corporate sector's `revenue` is a
 * DERIVED field: `sectorTurn` restates it from `capitalStock × mixPrice` on
 * every turn. Any other code that writes `corporateSectors.revenue` is
 * therefore one of two bugs —
 *
 *   - it is erased on the next tick (the player pays and keeps nothing), or
 *   - it is double-counted for one turn against capacity that never moved.
 *
 * That defect class was not one bug; it was a dozen, spread across attacks,
 * splits, sheds, R&D, transfers and restores, each of which looked locally
 * reasonable. This guard makes the class impossible to re-introduce silently:
 * every production file that writes the field must be listed here, with a
 * reason. A new writer fails this test until somebody writes down what it is
 * and how it behaves under plants.
 *
 * It is deliberately a REGISTRY plus a repo grep, not a type-level rule: the
 * writes happen through Mongo update documents, which no type system in this
 * codebase can constrain.
 *
 * `sectorTurn.ts` does not appear below because it does not write the field
 * through a literal update document — it assembles a `sectorUpdate` object. It
 * is, and remains, the authoritative writer.
 */

/** Where a Mongo update document or an insert argument begins. */
const UPDATE_DOC_START = /\$(?:inc|set|setOnInsert)\s*:\s*\{/g;
const INSERT_DOC_START = /\.insert(?:One|Many)\s*\(\s*[[{]/g;
const REVENUE_KEY = /\brevenue\s*:/;

/**
 * An insert into `corporateSectors` whose argument is a VARIABLE, not a literal.
 *
 * The two detectors above can only see a document they can read: they find the
 * `{` or `[` and scan it for a `revenue` key. An insert that hands over a
 * pre-built array — `db.collection("corporateSectors").insertMany(nppNewSectors)`
 * — has no document text at the call site at all, so it was completely invisible
 * to this guard. That is exactly the write that matters most: the docs are
 * assembled far away (in `nppCorporationBehavior`), and nothing tied the builder
 * to the writer.
 *
 * There is no way to follow the variable back to its shape with a grep, so this
 * rule does not try. It keys on the COLLECTION NAME being named right at the
 * insert, and treats any such indirect insert as a revenue writer that must be
 * registered and attested. The cost of being wrong is one registry entry
 * explaining that the docs carry no `revenue`; the cost of not having the rule
 * is a silent, unreviewed writer, which is what this file exists to prevent.
 */
const INDIRECT_INSERT =
  /\.collection\s*(?:<[^>]*>)?\s*\(\s*["'`]corporateSectors["'`]\s*\)\s*\.insert(?:One|Many)\s*\(\s*[A-Za-z_$]/;

/**
 * Return the source text of the object literal that begins at `open` (the index
 * of its `{` or `[`), by counting braces to the matching close.
 *
 * This replaces the regex that used to do the same job. That regex was wrong
 * three times running — a bare `[^{}]*` stops at the first nested brace; adding
 * `\{\}` fixed `...(x ?? {})` but not `...(cond ? {} : { revenue: ... })`; and
 * every widening step traded a false negative for a pile of false positives.
 * Balanced delimiters are not a regular language, so no amount of tuning was
 * going to work. A counter is exact, obvious, and cannot silently regress.
 *
 * Quotes and comments are not tracked. A brace inside a string literal would
 * skew the count — there are none in this repo's update documents, and the
 * failure direction is a false POSITIVE (an over-long span), which costs a
 * registry entry rather than a shipped bug.
 */
function balancedSpan(src: string, open: number): string {
  const CLOSE: Record<string, string> = { "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{" || ch === "[") stack.push(CLOSE[ch]);
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return src.slice(open, i + 1);
      if (stack.length === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** How many `$inc`/`$set`/`$setOnInsert` documents in `src` carry a `revenue` key? */
function countUpdateWrites(src: string): number {
  let n = 0;
  UPDATE_DOC_START.lastIndex = 0;
  for (let m = UPDATE_DOC_START.exec(src); m; m = UPDATE_DOC_START.exec(src)) {
    if (REVENUE_KEY.test(balancedSpan(src, m.index + m[0].length - 1))) n++;
  }
  return n;
}

/** How many `insertOne`/`insertMany` arguments in `src` carry a `revenue` key? */
function countInsertWrites(src: string): number {
  let n = 0;
  INSERT_DOC_START.lastIndex = 0;
  for (let m = INSERT_DOC_START.exec(src); m; m = INSERT_DOC_START.exec(src)) {
    if (REVENUE_KEY.test(balancedSpan(src, m.index + m[0].length - 1))) n++;
  }
  return n;
}

/** How many indirect `corporateSectors` inserts (variable argument) does `src` make? */
function countIndirectInserts(src: string): number {
  return src.match(new RegExp(INDIRECT_INSERT.source, "g"))?.length ?? 0;
}

/**
 * The total number of revenue-WRITE SITES this guard can see in one file.
 *
 * This is the quantity the registry PINS. See the `writeSites` field on
 * ALLOWED_WRITERS for why.
 */
function countRevenueWriteSites(src: string): number {
  return countUpdateWrites(src) + countInsertWrites(src) + countIndirectInserts(src);
}

type WriterStatus =
  /** Writes revenue only below the plants tier; the plants path moves capacity. */
  | "plants-gated"
  /**
   * Not yet reviewed against plants. Listed so it cannot grow silently, and so
   * the remaining work is visible. Owned by the ownership/transfer sweeps.
   */
  | "pending-review";

interface WriterEntry {
  /**
   * PINNED COUNT of revenue-write sites this guard can see in the file.
   *
   * Closes the guard's stated residual risk. The attestation marker is per FILE,
   * so once a file is registered and carries `PLANTS-GATED:` anywhere, a NEW
   * un-gated revenue write added to it was invisible: the file was already in
   * the registry, so assertions 1 and 2 stayed green, and assertion 3 found the
   * marker some other write had put there. That is the exact shape of the bug
   * this whole sweep chased — a fix applied to one member of a duplicated pair
   * while the twin call site diverges.
   *
   * A count cannot tell a good write from a bad one. What it CAN do is make the
   * file's write population a reviewed quantity: add or remove a write and the
   * number moves, the test fails, and somebody has to look at the new site and
   * re-pin deliberately. That converts a silent edit into a conversation.
   *
   * Re-pin by running the test — the failure message reports the actual count.
   */
  writeSites: number;
  status: WriterStatus;
  reason: string;
}

const ALLOWED_WRITERS: Record<string, WriterEntry> = {
  // ─── Reviewed and gated (this sweep) ─────────────────────────────────────
  "src/lib/nationalization/reverseNationalization.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason:
      "Hand-back restores formerCapitalStock alongside formerRevenue, so under " +
      "plants the nameplate is restated from the restored capacity next turn and " +
      "the revenue write is the legacy view, not the quantity.",
  },
  "src/lib/turn/corporation/rdInnovation.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason: "R&D breakthrough boosts capitalStock under plants, revenue below it.",
  },
  "src/lib/turn/corporation/corporationSectorShed.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason: "Vacant/inactive-CEO shed moves capacity units to pool headroom under plants.",
  },
  "src/app/api/country/[code]/region/[id]/economy/attack-sector/route.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason:
      "Split is plants-only; a new row starts at zero revenue and the turn derives its revenue from transferred whole plants.",
  },
  "src/app/api/country/[code]/region/[id]/economy/attack/route.ts": {
    writeSites: 5,
    status: "plants-gated",
    reason: "Unowned split draws headroomUnits down and grants capacity under plants.",
  },
  "src/lib/turn/nppCorporateAttacks.ts": {
    writeSites: 4,
    status: "plants-gated",
    reason: "NPP attacks share the player attack's capacity-transfer path.",
  },
  "src/lib/corporations/moveSector.ts": {
    writeSites: 2,
    status: "plants-gated",
    reason: "Sector transfers merge capitalStock + buildQueue under plants, not revenue.",
  },

  // ─── Reviewed by the concurrent plants sweeps (already plants-aware) ─────
  "src/lib/turn/unownedSectorGrowth.ts": {
    writeSites: 2,
    status: "plants-gated",
    reason:
      "GREP FALSE POSITIVE, registered to keep the sweep green: its revenue writes " +
      "target unownedSectors, not corporateSectors. It only READS corporateSectors " +
      "(line 64), which is enough to satisfy the collection filter above. Its pool " +
      "handling is plants-aware regardless.",
  },
  "src/lib/turn/autoSectorSeed.ts": {
    writeSites: 2,
    status: "plants-gated",
    reason: "World seeding of sectors; seeds capacity under plants.",
  },
  "src/lib/corporations/commands/sectorOperations/expandSector.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason:
      "Founding build; creates capacity under plants. The single remaining write is the " +
      "new sector's own doc (legacy nameplate, restated from capacity next tick) — the " +
      "pool drawdown's revenue leg is now the shared `unownedPoolTrailingSet` stage.",
  },
  "src/lib/admin/spawnNppCorporation.ts": {
    writeSites: 2,
    status: "plants-gated",
    reason: "NPP corp spawn; plants-aware sector creation.",
  },
  "src/lib/nationalization/ownershipTransition.ts": {
    writeSites: 2,
    status: "plants-gated",
    reason: "Nationalization ownership transfer; plants-aware.",
  },
  "src/lib/nationalization/nationalizeSectorWide.ts": {
    writeSites: 5,
    status: "plants-gated",
    reason:
      "Sector-wide nationalization. Both revenue writers are plants-gated off `plantsEnabled`: the carve into the NatCorp moves the donor's sliced plant state (capitalStock haircut by NATIONALIZATION_REVENUE_HAIRCUT, CIP and build orders at full value) and the donor keeps the 1−f complement, so capacity is conserved; the unowned-headroom capture increments capitalStock from the same ₳ figure as revenue.",
  },
  "src/lib/nationalization/privatizeAsset.ts": {
    writeSites: 2,
    status: "plants-gated",
    reason: "Privatization; plants-aware.",
  },

  // ─── Reviewed by the ownership/transfer sweep ────────────────────────────
  "src/lib/corporations/commands/sectorOperations/buyListedSector.ts": {
    writeSites: 4,
    status: "plants-gated",
    reason:
      "Marketplace purchase; merge path folds capitalStock/buildQueue/CIP via mergeSectorPlantFields.",
  },
  "src/lib/corporations/commands/takeovers/hostileTakeover.ts": {
    writeSites: 2,
    status: "plants-gated",
    reason: "Hostile takeover; merge path folds plant state via mergeSectorPlantFields.",
  },
  "src/lib/corporations/subsidiaries/commands/spinOff.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason: "Spin-off re-points corporationId, so plant state rides along on the same doc.",
  },

  // ─── Reviewed by the P3b audit sweep ─────────────────────────────────────
  "src/lib/corporations/repairDuplicateSectors.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason:
      "Duplicate-row heal is a MERGE; folds plant state via mergeSectorPlantFields before deleting.",
  },
  "src/lib/nationalization/seedToNatCorp.ts": {
    writeSites: 2,
    status: "plants-gated",
    reason: "Natcorp seed grants capitalStock units under plants; revenue written in lockstep.",
  },

  // ─── Found only once the regex was replaced by a brace scanner ────────────
  // All five hid from the old rule: the first two behind a `? {} :` ternary and
  // a far-away `Omit<CorporateSector` annotation, the migrations behind the
  // scan root, which used to be `src` only.
  "src/lib/corporations/convertCorpCurrency.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason:
      "Corp currency conversion rescales revenue only BELOW plants — at the plants tier " +
      "revenue is restated by the turn processor in the sector's host currency, so " +
      "rescaling it here would be overwritten anyway. Gated at the write.",
  },
  // NOTE — `src/lib/turn/nppCorporationBehavior.ts` was registered here while its
  // founding drawdown wrote `unownedSectors.revenue` from a literal `$set`. That
  // write is gone: the drawdown now moves `headroomUnits` and lets the shared
  // `unownedPoolTrailingSet` stage restate revenue, so the detector no longer
  // sees a revenue write in the file and a registry entry would be STALE. The
  // sector docs it builds are still covered — they are inserted by
  // `src/lib/turn/corporation/index.ts`, registered below.

  // ─── Found only once the detector learned about indirect inserts ─────────
  "src/lib/turn/corporation/index.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason:
      "The turn orchestrator's `insertMany(nppNewSectors)` — the WRITE half of the NPP " +
      "founding insert whose docs are built in `nppCorporationBehavior`. Hidden from this " +
      "guard until it stopped requiring a literal document at the call site. Under plants " +
      "each doc's `revenue` is the legacy nameplate only: capitalStock 0, founding order " +
      "queued, CIP set, plantsStartTurn stamped, and sectorTurn restates revenue next tick.",
  },

  "scripts/migrations/heal-cross-border-sector-country-mismatches.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason:
      "One-off historical heal, outside the deploy chain. Pre-dates plants and is not " +
      "re-runnable against a plants world; retained for the audit trail only.",
  },
  "scripts/migrations/heal-dropped-sector-unowned-loss.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason: "One-off historical heal, outside the deploy chain. Pre-dates plants.",
  },
  "scripts/migrations/heal-sector-revenue-anchor-bug.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason: "One-off historical heal, outside the deploy chain. Pre-dates plants.",
  },
  "scripts/migrations/fixSeedSectorCurrencyDenomination.ts": {
    writeSites: 1,
    status: "plants-gated",
    reason:
      "Seed-sector denomination heal. Changes the CURRENCY the field is expressed in, " +
      "never the quantity, so it cannot double-count capacity. Gated twice against " +
      "plants: the whole run returns early when marketSystemMode is at the plants tier " +
      "(revenue is derived there and restated in host currency every turn), and any " +
      "individual row with `plantsStartTurn` stamped is skipped by the planner.",
  },
};

/** Writers in this sweep's territory: these MUST carry a documented plants gate. */
const MUST_BE_PLANTS_AWARE = [
  "src/lib/turn/corporation/rdInnovation.ts",
  "src/lib/turn/corporation/corporationSectorShed.ts",
  "src/app/api/country/[code]/region/[id]/economy/attack-sector/route.ts",
  "src/app/api/country/[code]/region/[id]/economy/attack/route.ts",
  "src/lib/turn/nppCorporateAttacks.ts",
  "src/lib/corporations/moveSector.ts",
  // Converted by the ownership/transfer sweep and the P3b audit sweep. Once a
  // writer is reviewed it belongs here, so a later edit that quietly drops the
  // gate fails this test instead of silently regressing.
  "src/lib/corporations/commands/sectorOperations/buyListedSector.ts",
  "src/lib/corporations/commands/takeovers/hostileTakeover.ts",
  "src/lib/corporations/subsidiaries/commands/spinOff.ts",
  "src/lib/corporations/repairDuplicateSectors.ts",
  "src/lib/nationalization/seedToNatCorp.ts",
  "src/lib/nationalization/ownershipTransition.ts",
  // Surfaced only when the detector stopped being a regex — both were writing
  // the field in shapes the old pattern could not see.
  "src/lib/corporations/convertCorpCurrency.ts",
  // (`nppCorporationBehavior.ts` was here too — see the note in ALLOWED_WRITERS
  // for why it no longer writes the field at all.)
  // Surfaced by the indirect-insert rule.
  "src/lib/turn/corporation/index.ts",
  // The two nationalization writers. These were the guard's own worked example
  // of the failure it exists to prevent (see the attestation note below):
  // `nationalizeSectorWide` sat in ALLOWED_WRITERS, registered green, while BOTH
  // of its revenue writes were completely un-gated. Both files are now gated and
  // attested, so they belong in the enforced list — leaving them out means the
  // one regression this guard was written for is still the one it cannot catch.
  "src/lib/nationalization/nationalizeSectorWide.ts",
  "src/lib/nationalization/privatizeAsset.ts",
];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      // POSIX separators regardless of host: ALLOWED_WRITERS is keyed with "/",
      // and on Windows `join` yields "\" — which made every file read as an
      // unregistered writer and every registry entry as stale.
      acc.push(full.split(sep).join("/"));
    }
  }
  return acc;
}

function findRevenueWriters(): string[] {
  const out: string[] = [];
  for (const file of [...collectSourceFiles("src"), ...collectSourceFiles("scripts")]) {
    const src = readFileSync(file, "utf8");
    // Only files that actually touch the collection — `revenue` is a field on
    // unownedSectors, states, budgets and several DTOs too.
    if (!src.includes("corporateSectors")) continue;
    if (countRevenueWriteSites(src) > 0) out.push(file);
  }
  return out.sort();
}

describe("corporateSectors.revenue writer registry", () => {
  it("has no unregistered writer", () => {
    const unregistered = findRevenueWriters().filter((f) => !(f in ALLOWED_WRITERS));
    expect(
      unregistered,
      "New write site(s) to corporateSectors.revenue.\n" +
        "Under plants that field is DERIVED from capitalStock and is restated every turn,\n" +
        "so this write is either erased or double-counted. Move the quantity onto capacity,\n" +
        "or gate the revenue write on the market tier — then register the file in\n" +
        "ALLOWED_WRITERS with a reason:\n" +
        unregistered.join("\n")
    ).toEqual([]);
  });

  it("has no stale registry entry", () => {
    const actual = new Set(findRevenueWriters());
    const stale = Object.keys(ALLOWED_WRITERS).filter((f) => !actual.has(f));
    expect(
      stale,
      `Registered file(s) no longer write corporateSectors.revenue — drop them:\n${stale.join("\n")}`
    ).toEqual([]);
  });

  it("no attested file has grown or lost a revenue-write site", () => {
    // LINE-COUNT PINNING — see the `writeSites` doc on WriterEntry.
    //
    // Reported as one aggregated diff rather than an assertion per file so a
    // sweep that legitimately moves several sites shows the whole picture at
    // once, with the numbers to paste back into the registry.
    const drift: string[] = [];
    for (const [file, entry] of Object.entries(ALLOWED_WRITERS)) {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue; // a deleted file is assertion 2's job to report, not this one
      }
      const actual = countRevenueWriteSites(src);
      if (actual !== entry.writeSites) {
        drift.push(`  ${file}: registered ${entry.writeSites}, found ${actual}`);
      }
    }
    expect(
      drift,
      "Revenue-write site COUNT changed in already-registered file(s).\n" +
        "The per-file `PLANTS-GATED:` attestation cannot see a new write added to a file\n" +
        "that was already attested, so the count is pinned instead. If you ADDED a write:\n" +
        "confirm it is gated on the market tier (or moves capacity instead of revenue),\n" +
        "extend that file's `reason` to cover it, then update `writeSites`. If you REMOVED\n" +
        "one, just update `writeSites`.\n" +
        drift.join("\n")
    ).toEqual([]);
  });

  it("every reviewed writer in this sweep carries a documented plants gate", () => {
    // PER-SITE MARKER, not a whole-file substring.
    //
    // The first version of this check was `/plants/i.test(src)` over the whole
    // file, which ANY incidental mention satisfied — a comment, or an unrelated
    // valuation branch a hundred lines away. That is how `nationalizeSectorWide`
    // came to be registered green while both of its revenue writers were in fact
    // completely un-gated.
    //
    // Proximity-to-the-write was tried next and is no better: the real gates in
    // this codebase sit at the top of a function and the write sits inside a
    // nested `else`, so any window wide enough to admit the honest sites is also
    // wide enough to admit the dishonest ones. There is no textual distance that
    // separates them.
    //
    // So the gate is an explicit ATTESTATION. A reviewed writer must carry the
    // literal marker below, in a comment, naming what its revenue writes do
    // under plants. It cannot be produced by an incidental mention of the word,
    // it does not depend on how the file is laid out, and it puts the rationale
    // where the next person to edit that file will read it.
    //
    // KNOWN LIMIT, stated so nobody mistakes this for more than it is: the
    // marker is per FILE, not per write site, so it cannot by itself detect a
    // NEW un-gated write added to an already-attested file. The registry's first
    // two assertions catch a new writer FILE; this one catches an unattested
    // file; neither catches a new writer LINE in an old file.
    //
    // That gap is covered — as far as a grep can cover it — by the `writeSites`
    // pin and the count assertion above: the new LINE moves the file's count and
    // fails the build until somebody re-pins it deliberately. The pin proves a
    // human looked, not that the write is correct, which is why the `reason`
    // fields are still expected to be specific enough to go visibly stale.
    const PLANTS_MARKER = "PLANTS-GATED:";
    const missing = MUST_BE_PLANTS_AWARE.filter(
      (f) => !readFileSync(f, "utf8").includes(PLANTS_MARKER)
    );
    expect(missing, `Missing a plants gate / rationale:\n${missing.join("\n")}`).toEqual([]);
    for (const file of MUST_BE_PLANTS_AWARE) {
      expect(ALLOWED_WRITERS[file]?.status).toBe("plants-gated");
    }
  });
});
