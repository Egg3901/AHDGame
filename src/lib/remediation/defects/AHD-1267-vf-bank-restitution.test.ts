import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  DEFECT_ID,
  HUNT_OIL_ID,
  HUNT_RESIDUAL_USD,
  MERGE_TURN,
  NPC_RETURN_USD,
  US_CB_ID,
  VERMONT_FINANCE_ID,
  defect,
} from "./AHD-1267-vf-bank-restitution";
import type { HealContext } from "../types";

const emitTxBulk = vi.fn();

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk: async (...args: unknown[]) => emitTxBulk(...args),
  loadTxThresholds: async () => ({}),
}));

function ctx(): HealContext {
  return { env: "prod", dryRun: false, runId: "run-1267", now: new Date("2026-09-04T00:00:00Z") };
}

describe("AHD-1267 pinned restitution", () => {
  it("pins the destroyed bank's two legs at screenshot precision", () => {
    expect(DEFECT_ID).toBe("AHD-1267-vf-bank-restitution");
    expect(MERGE_TURN).toBe(605);
    expect(VERMONT_FINANCE_ID).toHaveLength(24);
    expect(HUNT_OIL_ID).toHaveLength(24);
    expect(US_CB_ID).toBe("US");
    // Owner residual min(123.41 − 71.11 vault cash over book, 52.29 equity).
    expect(HUNT_RESIDUAL_USD).toBe(52_290_000);
    expect(NPC_RETURN_USD).toBe(71_110_000);
    expect(defect.guards).toContain("turn-lock-free");
    expect(defect.guards).toContain("max-affected:2");
    expect(defect.mintsMoney).toBe(true);
    expect(defect.idempotent).toBe(true);
    expect(defect.envs).toEqual(["prod"]);
    expect(defect.seedFix.status).toBe("not-needed");
    expect(defect.codeFix?.pr).toBe(1389);
    expect(defect.codeFix?.requiredCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("AHD-1267 detect/plan/apply/verify", () => {
  let memory: InMemoryDb;

  function db(): Db {
    return memory as unknown as Db;
  }

  function seed() {
    memory = createInMemoryDb();
    memory.seed("corporations", [
      {
        _id: new ObjectId(HUNT_OIL_ID),
        name: "Hunt Oil Company",
        liquidCapital: 330_432,
        liquidCurrencyCode: "USD",
      },
    ]);
    memory.seed("centralBanks", [{ _id: US_CB_ID, externalBroadMoney: 60_477_490_752 }]);
  }

  function hunt(): { liquidCapital: number; remediation?: Record<string, unknown> } {
    const doc = memory
      .collection("corporations")
      .docs.find((d) => (d._id as ObjectId).toHexString() === HUNT_OIL_ID) as unknown as {
      liquidCapital: number;
      remediation?: Record<string, unknown>;
    };
    if (!doc) throw new Error("Hunt Oil missing");
    return doc;
  }

  function usCb(): { externalBroadMoney: number; remediation?: Record<string, unknown> } {
    const doc = memory
      .collection("centralBanks")
      .docs.find((d) => d._id === US_CB_ID) as unknown as {
      externalBroadMoney: number;
      remediation?: Record<string, unknown>;
    };
    if (!doc) throw new Error("US central bank missing");
    return doc;
  }

  it("detects two owed legs, plans both with the full money delta, and verifies clean after apply", async () => {
    seed();
    vi.clearAllMocks();

    const detected = await defect.detect(db(), ctx());
    expect(detected.affected).toBe(2);

    const planned = await defect.plan(db(), ctx());
    expect(planned.affected).toBe(2);
    expect(planned.moneyDelta).toBe(HUNT_RESIDUAL_USD + NPC_RETURN_USD);
    expect(planned.touched).toHaveLength(2);
    expect(planned.summary).toMatch(/AHD-1267/);

    const applied = await defect.apply(db(), planned, ctx());
    expect(applied.documentsUpdated).toBe(2);
    expect(hunt().liquidCapital).toBe(330_432 + HUNT_RESIDUAL_USD);
    expect(usCb().externalBroadMoney).toBe(60_477_490_752 + NPC_RETURN_USD);
    expect(hunt().remediation?.[DEFECT_ID]).toMatchObject({
      ticket: 1267,
      amount: HUNT_RESIDUAL_USD,
    });
    expect(usCb().remediation?.[DEFECT_ID]).toMatchObject({ ticket: 1267, amount: NPC_RETURN_USD });

    // Both legs attributed to the destroyed charter on the shadow ledger.
    expect(emitTxBulk).toHaveBeenCalledTimes(1);
    const entries = emitTxBulk.mock.calls[0][1] as {
      type: string;
      turn: number;
      subjectType: string;
      amount: number;
      meta: Record<string, unknown>;
    }[];
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.type)).toEqual(["restitution_credit", "restitution_credit"]);
    expect(entries.every((e) => e.turn === MERGE_TURN)).toBe(true);
    expect(entries.every((e) => e.meta.ticket === 1267 && e.meta.defectId === DEFECT_ID)).toBe(
      true
    );

    const verified = await defect.verify(db(), ctx());
    expect(verified).toMatchObject({ ok: true, remaining: 0 });

    // A re-run is a safe no-op: markers present, nothing matches.
    const replanned = await defect.plan(db(), ctx());
    expect(replanned.affected).toBe(0);
    expect(replanned.moneyDelta).toBe(0);
    const reapplied = await defect.apply(db(), replanned, ctx());
    expect(reapplied.documentsUpdated).toBe(0);
    expect(hunt().liquidCapital).toBe(330_432 + HUNT_RESIDUAL_USD);
  });

  it("reads as clean when a recipient is gone", async () => {
    memory = createInMemoryDb();
    memory.seed("centralBanks", [{ _id: US_CB_ID, externalBroadMoney: 1 }]);

    const detected = await defect.detect(db(), ctx());
    expect(detected.affected).toBe(1);
    expect(detected.sample[0]).toMatchObject({ kind: "npc-return" });
  });
});
