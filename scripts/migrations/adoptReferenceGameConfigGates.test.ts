/**
 * Guard-rail tests for the gameConfig gate reconciliation.
 *
 * The migration is allowed to move a world's market tier, which is the one
 * thing the D14 protection exists to stop a seed from doing. Its licence to do
 * so rests entirely on three refusals — never override an operator, never move
 * a tier DOWN, never touch a world with an economy to rebase — so those are
 * what is pinned here, alongside the absent-gate fill.
 */
import { describe, expect, it } from "vitest";
import { runAdoptReferenceGameConfigGates } from "./adoptReferenceGameConfigGates";
import { gameConfig as referenceGameConfig } from "../../src/lib/seeds/reference/gameConfig";
import { MARKET_MODE_ORDER } from "../../src/lib/market/modes";

type Doc = Record<string, unknown>;

/** Minimal Db stand-in: one gameConfig doc, one gameState doc, capture writes. */
function fakeDb(gameConfig: Doc | null, currentTurn: number | null) {
  const updates: Doc[] = [];
  const adminLogs: Doc[] = [];
  const db = {
    collection(name: string) {
      if (name === "gameConfig") {
        return {
          findOne: async () => gameConfig,
          updateOne: async (_filter: Doc, update: { $set: Doc }) => {
            updates.push(update.$set);
          },
        };
      }
      if (name === "gameState") {
        return { findOne: async () => (currentTurn === null ? null : { currentTurn }) };
      }
      if (name === "adminLogs") {
        return {
          insertOne: async (doc: Doc) => {
            adminLogs.push(doc);
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
  // The migration only uses findOne/updateOne/insertOne on three collections.
  return { db: db as never, updates, adminLogs };
}

const TOP_TIER = MARKET_MODE_ORDER[MARKET_MODE_ORDER.length - 1];
const BELOW_TOP = MARKET_MODE_ORDER[MARKET_MODE_ORDER.length - 2];

/** A live doc carrying every reference key, so pass 1 finds nothing absent. */
function fullyPopulated(overrides: Doc = {}): Doc {
  return { ...referenceGameConfig, ...overrides };
}

describe("adoptReferenceGameConfigGates — market tier refusals", () => {
  it("refuses to touch a tier an operator chose", async () => {
    const { db, updates } = fakeDb(
      fullyPopulated({ marketSystemMode: "ledger", marketSystemModeUpdatedBy: "egg3901" }),
      2
    );
    const result = await runAdoptReferenceGameConfigGates(db, {});
    expect(updates).toHaveLength(0);
    expect(result.notes?.join(" ")).toContain("an operator chose it");
  });

  it("refuses to move a tier DOWN", async () => {
    // A world already at the top must not be dragged back if the reference
    // default is ever lowered — that is the silent-rebase hazard.
    const { db, updates } = fakeDb(fullyPopulated({ marketSystemMode: TOP_TIER }), 2);
    await runAdoptReferenceGameConfigGates(db, {});
    expect(updates).toHaveLength(0);
  });

  it("refuses to touch a world past its first game day", async () => {
    const { db, updates } = fakeDb(fullyPopulated({ marketSystemMode: "ledger" }), 500);
    const result = await runAdoptReferenceGameConfigGates(db, {});
    expect(updates).toHaveLength(0);
    expect(result.notes?.join(" ")).toContain("past its first game day");
  });

  it("raises an unchosen tier on a world with no economy yet, and stamps it", async () => {
    const { db, updates, adminLogs } = fakeDb(fullyPopulated({ marketSystemMode: "ledger" }), 2);
    await runAdoptReferenceGameConfigGates(db, {});
    expect(updates).toHaveLength(1);
    expect(updates[0].marketSystemMode).toBe(referenceGameConfig.marketSystemMode);
    expect(updates[0].marketSystemModeUpdatedBy).toBe("system:migration");
    expect(updates[0].marketSystemModeUpdatedTurn).toBe(2);
    expect(adminLogs).toHaveLength(1);
  });

  it("is a no-op on a second run, because it stamped its own provenance", async () => {
    const { db, updates } = fakeDb(
      fullyPopulated({ marketSystemMode: TOP_TIER, marketSystemModeUpdatedBy: "system:migration" }),
      2
    );
    await runAdoptReferenceGameConfigGates(db, {});
    expect(updates).toHaveLength(0);
  });
});

describe("adoptReferenceGameConfigGates — gates", () => {
  it("fills a gate the world never had", async () => {
    const { db, updates } = fakeDb(fullyPopulated({ nppCorpsAttackable: undefined }), 2);
    await runAdoptReferenceGameConfigGates(db, {});
    expect(updates[0].nppCorpsAttackable).toBe(referenceGameConfig.nppCorpsAttackable);
  });

  it("re-adopts a diverging gate on a world still in its first day", async () => {
    // The shadow-ledger case: seeded false by an older build's reference, which
    // is a fossil of that build rather than a decision.
    const { db, updates } = fakeDb(fullyPopulated({ ledgerShadow: false }), 2);
    await runAdoptReferenceGameConfigGates(db, {});
    expect(updates[0].ledgerShadow).toBe(referenceGameConfig.ledgerShadow);
  });

  it("leaves a diverging gate alone once the world is past its first day", async () => {
    const { db, updates } = fakeDb(fullyPopulated({ ledgerShadow: false }), 500);
    await runAdoptReferenceGameConfigGates(db, {});
    expect(updates).toHaveLength(0);
  });

  it("never touches numeric tuning, even on a fresh world", async () => {
    const { db, updates } = fakeDb(fullyPopulated({ startingFunds: 1, turnLengthMinutes: 5 }), 2);
    await runAdoptReferenceGameConfigGates(db, {});
    expect(updates[0] ?? {}).not.toHaveProperty("startingFunds");
    expect(updates[0] ?? {}).not.toHaveProperty("turnLengthMinutes");
  });

  it("never writes _id", async () => {
    const { db, updates } = fakeDb({ marketSystemMode: BELOW_TOP }, 2);
    await runAdoptReferenceGameConfigGates(db, {});
    expect(updates[0]).not.toHaveProperty("_id");
  });

  it("reports and writes nothing on a dry run", async () => {
    const { db, updates, adminLogs } = fakeDb(fullyPopulated({ marketSystemMode: "ledger" }), 2);
    const result = await runAdoptReferenceGameConfigGates(db, { dryRun: true });
    expect(updates).toHaveLength(0);
    expect(adminLogs).toHaveLength(0);
    expect(result.notes?.join(" ")).toContain("DRY RUN");
  });
});
