import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import {
  acquireConstructionAdmission,
  releaseConstructionAdmission,
  recoverConstructionAdmissions,
  setConstructionFinanceEnabled,
} from "../constructionAdmission";

function world() {
  const memory = createInMemoryDb();
  memory.seed("gameConfig", [
    {
      _id: "default",
      privateBankingEnabled: true,
      treasuryCashLedgerEnabled: true,
      bankConstructionFinanceEnabled: true,
    },
  ]);
  return { memory, db: memory as unknown as Db };
}
const admission = { token: "request-one", loanId: "loan-one", turn: 10 };
describe("construction admission and disable", () => {
  it("refuses admission and enabling when Treasury cash accounting is off", async () => {
    const w = world();
    await w.db
      .collection<{ _id: string }>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { treasuryCashLedgerEnabled: false } });
    expect(await acquireConstructionAdmission(w.db, admission)).toBe(false);
    expect(await setConstructionFinanceEnabled(w.db, true)).toMatchObject({ ok: false });
  });
  it("keeps distinct racing request tokens and refuses disable until they clear", async () => {
    const w = world();
    expect(await acquireConstructionAdmission(w.db, admission)).toBe(true);
    expect(await acquireConstructionAdmission(w.db, admission)).toBe(true);
    expect(await acquireConstructionAdmission(w.db, { ...admission, token: "request-two" })).toBe(
      true
    );
    expect(w.memory.collection("gameConfig").docs[0].bankConstructionAdmissions).toHaveLength(2);
    expect(await setConstructionFinanceEnabled(w.db, false)).toMatchObject({ ok: false });
    await releaseConstructionAdmission(w.db, admission.token);
    expect(await setConstructionFinanceEnabled(w.db, false)).toMatchObject({ ok: false });
    await releaseConstructionAdmission(w.db, "request-two");
    expect(await setConstructionFinanceEnabled(w.db, false)).toEqual({ ok: true });
    expect(await acquireConstructionAdmission(w.db, admission)).toBe(false);
  });

  it("blocks fresh admission under a killed disable barrier and safely resumes disable", async () => {
    const w = world();
    const fault = withInjectedCrash(w.memory, {
      collection: "gameConfig",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
      matches: (args) =>
        (args[1] as { $set?: Record<string, unknown> }).$set?.bankConstructionAdmissionClosing ===
        true,
    });
    await expect(setConstructionFinanceEnabled(fault.db, false)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    expect(await acquireConstructionAdmission(w.db, admission)).toBe(false);
    expect(await setConstructionFinanceEnabled(w.db, false)).toEqual({ ok: true });
  });

  it("does not let an older disable clear a newer continuous barrier", async () => {
    const w = world();
    let releaseFirst!: (value: number) => void, releaseSecond!: (value: number) => void;
    const firstCount = new Promise<number>((resolve) => {
      releaseFirst = resolve;
    });
    const secondCount = new Promise<number>((resolve) => {
      releaseSecond = resolve;
    });
    const sectorCollection = w.db.collection("corporateSectors");
    let firstEntered!: () => void, secondEntered!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      secondEntered = resolve;
    });
    vi.spyOn(sectorCollection, "countDocuments")
      .mockImplementationOnce(() => {
        firstEntered();
        return firstCount;
      })
      .mockImplementationOnce(() => {
        secondEntered();
        return secondCount;
      });
    const first = setConstructionFinanceEnabled(w.db, false);
    await firstStarted;
    const second = setConstructionFinanceEnabled(w.db, false);
    await secondStarted;
    releaseFirst(0);
    expect(await first).toMatchObject({ ok: false });
    try {
      expect(w.memory.collection("gameConfig").docs[0].bankConstructionAdmissionClosing).toBe(true);
      expect(await acquireConstructionAdmission(w.db, admission)).toBe(false);
    } finally {
      releaseSecond(0);
    }
    expect(await second).toEqual({ ok: true });
    expect(w.memory.collection("gameConfig").docs[0].bankConstructionFinanceEnabled).toBe(false);
  });

  it.each([
    { constructionFinancing: { status: "building", escrowLocal: 0 } },
    { constructionFinancing: { status: "released", escrowLocal: 5 } },
    { constructionFinancing: { status: "awaiting_approval", escrowLocal: 0 } },
    { constructionPropertyTransition: { key: "owned", kind: "secured_sale" } },
  ])("retains recovery and M2 visibility while an obligation exists: %j", async (sector) => {
    const w = world();
    w.memory.seed("corporateSectors", [sector]);
    expect(await setConstructionFinanceEnabled(w.db, false)).toMatchObject({ ok: false });
    expect(w.memory.collection("gameConfig").docs[0].bankConstructionFinanceEnabled).toBe(true);
    expect(
      w.memory.collection("gameConfig").docs[0].bankConstructionAdmissionClosing
    ).toBeUndefined();
    expect(await acquireConstructionAdmission(w.db, admission)).toBe(true);
  });

  it("cleans only older orphan admission tokens and preserves pending borrower claims", async () => {
    const w = world();
    await acquireConstructionAdmission(w.db, admission);
    await acquireConstructionAdmission(w.db, { ...admission, token: "claim-token" });
    w.memory.seed("corporateSectors", [
      {
        constructionFinancing: {
          admissionToken: "claim-token",
          status: "awaiting_approval",
          escrowLocal: 0,
        },
      },
    ]);
    await recoverConstructionAdmissions(w.db, 10);
    expect(w.memory.collection("gameConfig").docs[0].bankConstructionAdmissions).toHaveLength(2);
    await recoverConstructionAdmissions(w.db, 11);
    expect(w.memory.collection("gameConfig").docs[0].bankConstructionAdmissions).toEqual([
      { ...admission, token: "claim-token" },
    ]);
    expect(await setConstructionFinanceEnabled(w.db, false)).toMatchObject({ ok: false });
  });
});
