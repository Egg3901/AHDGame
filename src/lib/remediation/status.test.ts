import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { makeStrictInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { defectStatus, formatMatrix, ledgerStatus, type EnvResolver } from "./status";
import type { Defect, HealEnv } from "./types";

const ENVS: HealEnv[] = ["dev", "sandbox", "prod"];

function makeDefect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "AHD-x",
    title: "bad widgets",
    severity: "P1",
    seedFix: { status: "not-needed", note: "runtime only" },
    envs: ["dev", "sandbox", "prod"],
    idempotent: true,
    guards: ["max-affected:100"],
    detect: async (db) => {
      const bad = await db.collection("widgets").find({ bad: true }).toArray();
      return { affected: bad.length, sample: bad };
    },
    plan: async () => ({ affected: 0, touched: [], moneyDelta: 0, summary: "" }),
    apply: async () => ({}),
    verify: async () => ({ ok: true, remaining: 0, notes: [] }),
    ...overrides,
  };
}

/** dev clean, sandbox dirty, prod unconfigured — the shape we actually live in. */
function makeResolver(overrides: Partial<Record<HealEnv, Db | null>> = {}): EnvResolver {
  const dev = makeStrictInMemoryStore({ widgets: [{ _id: "w1", bad: false }] }).db;
  const sandbox = makeStrictInMemoryStore({
    widgets: [
      { _id: "w1", bad: true },
      { _id: "w2", bad: true },
    ],
  }).db;
  const defaults: Record<HealEnv, Db | null> = { dev, sandbox, prod: null };
  return async (env) => ({ ...defaults, ...overrides })[env];
}

describe("defectStatus", () => {
  it("reports each env separately", async () => {
    const status = await defectStatus(makeDefect(), ENVS, makeResolver());

    expect(status.envs.find((e) => e.env === "dev")).toMatchObject({
      state: "clean",
      affected: 0,
    });
    expect(status.envs.find((e) => e.env === "sandbox")).toMatchObject({
      state: "dirty",
      affected: 2,
    });
    expect(status.envs.find((e) => e.env === "prod")).toMatchObject({
      state: "unconfigured",
      configured: false,
    });
  });

  it("flags anyDirty when a single env is dirty", async () => {
    // This is the whole point: prod is clean, so nobody notices, but sandbox
    // has been broken since the heal that only ever ran against prod.
    const status = await defectStatus(makeDefect(), ENVS, makeResolver());
    expect(status.anyDirty).toBe(true);
  });

  it("is not dirty when every configured env is clean", async () => {
    const clean = makeStrictInMemoryStore({ widgets: [{ _id: "w1", bad: false }] }).db;
    const status = await defectStatus(makeDefect(), ENVS, makeResolver({ sandbox: clean }));
    expect(status.anyDirty).toBe(false);
  });

  it("marks an env the defect is not registered for", async () => {
    const status = await defectStatus(makeDefect({ envs: ["prod"] }), ENVS, makeResolver());
    expect(status.envs.find((e) => e.env === "dev")?.state).toBe("unconfigured");
    expect(status.envs.find((e) => e.env === "dev")?.error).toContain("not registered");
  });

  it("survives a detector that throws in one env", async () => {
    const exploding = makeDefect({
      detect: async (db) => {
        if ((await db.collection("widgets").countDocuments({ bad: true })) > 0) {
          throw new Error("detector blew up");
        }
        return { affected: 0, sample: [] };
      },
    });
    const status = await defectStatus(exploding, ENVS, makeResolver());
    expect(status.envs.find((e) => e.env === "sandbox")).toMatchObject({ state: "error" });
    // A broken detector in one env must not hide a clean verdict in another.
    expect(status.envs.find((e) => e.env === "dev")?.state).toBe("clean");
  });

  it("surfaces an unassessed seed as a warning", async () => {
    const status = await defectStatus(
      makeDefect({ seedFix: { status: "unknown" } }),
      ENVS,
      makeResolver()
    );
    expect(status.warnings.join(" ")).toContain("SEED NOT ASSESSED");
  });

  it("warns when a code fix is named but not pinned", async () => {
    const status = await defectStatus(makeDefect({ codeFix: { pr: 1234 } }), ENVS, makeResolver());
    expect(status.warnings.join(" ")).toContain("pins no requiredCommit");
  });

  it("warns when no code fix is recorded", async () => {
    const status = await defectStatus(
      makeDefect({ codeFix: undefined, seedFix: { status: "unknown" } }),
      ENVS,
      makeResolver()
    );
    expect(status.warnings.join(" ")).toContain("records no code fix");
  });

  it("treats an unreachable env as unknown, never as clean", async () => {
    const status = await defectStatus(makeDefect(), ENVS, async (env) => {
      if (env === "sandbox") throw new Error("connection refused");
      return makeResolver()(env);
    });
    expect(status.envs.find((e) => e.env === "sandbox")?.state).toBe("error");
    expect(status.warnings.join(" ")).toContain("detector could not run");
  });
});

describe("ledgerStatus", () => {
  it("collects the dirty subset across defects", async () => {
    const clean = makeStrictInMemoryStore({ widgets: [{ _id: "w1", bad: false }] }).db;
    const result = await ledgerStatus(
      [makeDefect({ id: "AHD-dirty" }), makeDefect({ id: "AHD-clean" })],
      ENVS,
      async (env) => (env === "sandbox" ? makeResolver()("sandbox") : clean)
    );
    expect(result.defects).toHaveLength(2);
    expect(result.dirty).toHaveLength(2);
  });
});

describe("formatMatrix", () => {
  it("renders one row per defect with a seed marker", async () => {
    const status = await defectStatus(
      makeDefect({ seedFix: { status: "unknown" } }),
      ENVS,
      makeResolver()
    );
    const text = formatMatrix([status], ENVS);
    expect(text).toContain("AHD-x");
    expect(text).toContain("clean");
    expect(text).toContain("DIRTY 2");
    expect(text).toContain("[seed?]");
  });
});
