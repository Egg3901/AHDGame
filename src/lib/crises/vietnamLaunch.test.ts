import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

const { createCrisisFromTemplate } = vi.hoisted(() => ({
  createCrisisFromTemplate: vi.fn(),
}));
vi.mock("./createCrisisFromTemplate", () => ({ createCrisisFromTemplate }));
vi.mock("./vietnamWire", () => ({
  announceVietnamChainStart: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/crisisTurn", () => ({
  announceCrisisStart: vi.fn().mockResolvedValue(undefined),
}));

import {
  openVietnamChain,
  processVietnamChainOpening,
  VIETNAM_COMMITMENT_TEMPLATE_KEYS,
} from "./crisisChain";
import { announceVietnamChainStart } from "./vietnamWire";
import { announceCrisisStart } from "@/lib/turn/crisisTurn";
import { ALL_CRISIS_TEMPLATES, VIETNAM_DECISION_WINDOW_MINUTES } from "./templates";
import {
  getVietnamEscalation,
  VIETNAM_FROM_YEAR,
  VIETNAM_UNTIL_YEAR,
  vietnamTemplateKeyForLevel,
} from "./vietnamEscalation";
import type { CrisisTemplate } from "@/lib/db/types/crisis";

// ── Minimal store: the ladder singleton plus a crises collection. ────────────

function makeDb() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  const col = (name: string) => {
    let m = store.get(name);
    if (!m) {
      m = new Map();
      store.set(name, m);
    }
    return m;
  };
  return {
    store,
    collection(name: string) {
      const m = col(name);
      return {
        async findOne(filter: Record<string, unknown>) {
          if (filter._id != null) return m.get(String(filter._id)) ?? null;
          return [...m.values()][0] ?? null;
        },
        async updateOne(
          filter: Record<string, unknown>,
          update: { $set: Record<string, unknown> },
          opts?: { upsert?: boolean }
        ) {
          const key = String(filter._id);
          const existing = m.get(key);
          if (!existing && !opts?.upsert) return;
          m.set(key, { ...(existing ?? { _id: key }), ...update.$set });
        },
      };
    },
  };
}

type FakeDb = ReturnType<typeof makeDb>;
const asDb = (db: FakeDb) => db as unknown as Db;

const IN_WINDOW = 1962;

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = makeDb();
  // Stand in for the real factory: allocate an id and leave a crisis document
  // behind, so the launcher's "look it up and announce it" step has something
  // to find, exactly as it would in a real world.
  createCrisisFromTemplate.mockImplementation(async () => {
    const id = new ObjectId();
    await db
      .collection("crises")
      .updateOne({ _id: id }, { $set: { _id: id, name: "spawned" } }, { upsert: true });
    return id;
  });
});

const commitmentTemplates = VIETNAM_COMMITMENT_TEMPLATE_KEYS.map(
  (key) => [key, ALL_CRISIS_TEMPLATES[key] as CrisisTemplate] as const
);

describe("Vietnam commitment decisions", () => {
  it("registers one launch decision per superpower", () => {
    expect(commitmentTemplates).toHaveLength(2);
    const countries = commitmentTemplates.map(([, t]) => t.countryIds).flat();
    expect(countries.sort()).toEqual(["RU", "US"]);
    for (const [key, t] of commitmentTemplates) {
      expect(t.scope, key).toBe("country");
      expect(t.countryIds.length, key).toBe(1);
    }
  });

  it("gives each administration its own framing, not a shared node", () => {
    const [[, us], [, ussr]] = commitmentTemplates;
    expect(us.name).not.toBe(ussr.name);
    expect(us.description).not.toBe(ussr.description);
    expect(us.interactionDefinition!.decisionTree[0].description).not.toBe(
      ussr.interactionDefinition!.decisionTree[0].description
    );
  });

  it("opens a 24 hour real-time response window", () => {
    expect(VIETNAM_DECISION_WINDOW_MINUTES).toBe(24 * 60);
    for (const [key, t] of commitmentTemplates) {
      const node = t.interactionDefinition!.decisionTree[0];
      expect(node.timeLimitMinutes, key).toBe(VIETNAM_DECISION_WINDOW_MINUTES);
      expect(t.interactionDefinition!.autoResolveOnExpiry, key).toBe(true);
    }
  });

  it("defaults a silent administration to holding, never to a war", () => {
    for (const [key, t] of commitmentTemplates) {
      const options = t.interactionDefinition!.decisionTree[0].options!;
      // autoResolveCrisisInteraction takes the option named "decline", or the
      // FIRST option. Neither template has a "decline", so first place is what
      // decides what a no-show does.
      expect(
        options.some((o) => o.optionId === "decline"),
        key
      ).toBe(false);
      expect(options[0].optionId, key).toBe("vietnam_hold_advisory");
      // Auto-resolution applies effects but never fires actions, so the default
      // must not need one. Holding the line moves nothing on the ladder, which
      // is exactly what a timeout should do.
      expect(options[0].action, key).toBeUndefined();
    }
  });

  it("wires getting in and getting out to the real ladder", () => {
    for (const [key, t] of commitmentTemplates) {
      const options = t.interactionDefinition!.decisionTree[0].options!;
      expect(options.find((o) => o.optionId === "vietnam_commit")!.action, key).toEqual({
        kind: "vietnamSupport",
      });
      expect(options.find((o) => o.optionId === "vietnam_disengage")!.action, key).toEqual({
        kind: "vietnamDeescalate",
      });
    }
  });

  it("resolves to a terminal node so the decision cannot hang open", () => {
    for (const [key, t] of commitmentTemplates) {
      const tree = t.interactionDefinition!.decisionTree;
      const terminal = tree.find((n) => n.type === "terminal");
      expect(terminal, key).toBeDefined();
      for (const option of tree[0].options!) {
        expect(option.nextNodeId, `${key}/${option.optionId}`).toBe(terminal!.nodeId);
      }
    }
  });

  it("is not a rung, so the chain never tries to follow it", () => {
    for (const [key, t] of commitmentTemplates) {
      expect(t.chain, key).toBeUndefined();
      expect(t.autoTrigger, key).toBeUndefined();
    }
  });

  it("stays inside the era window", () => {
    for (const [key, t] of commitmentTemplates) {
      expect(t.fromYear, key).toBe(VIETNAM_FROM_YEAR);
      expect(t.untilYear, key).toBe(VIETNAM_UNTIL_YEAR);
    }
  });

  it("uses no em or en dashes in anything a player reads", () => {
    const copy: string[] = [];
    for (const [, t] of commitmentTemplates) {
      copy.push(t.name, t.description, t.wireMessageOnStart, t.wireMessageOnEnd ?? "");
      for (const node of t.interactionDefinition!.decisionTree) {
        copy.push(node.title, node.description);
        for (const option of node.options ?? []) copy.push(option.label, option.description);
      }
    }
    expect(copy.filter((line) => /[–—]/.test(line))).toEqual([]);
  });
});

describe("openVietnamChain", () => {
  it("starts the chain, the two decisions and the coverage in one go", async () => {
    const result = await openVietnamChain(asDb(db), 20, IN_WINDOW);

    expect(result.started).toBe(true);
    expect(result.level).toBe(1);
    expect(result.crisisIds).toHaveLength(3);

    const spawned = createCrisisFromTemplate.mock.calls.map(
      (c) => (c[1] as { templateKey: string }).templateKey
    );
    expect(spawned).toEqual([vietnamTemplateKeyForLevel(1), ...VIETNAM_COMMITMENT_TEMPLATE_KEYS]);
    expect(vi.mocked(announceVietnamChainStart)).toHaveBeenCalledWith(1);
  });

  it("announces every spawned crisis, which the turn loop would otherwise miss", async () => {
    await openVietnamChain(asDb(db), 20, IN_WINDOW);
    // A crisis created outside the `turn === startTurn` branch is never
    // announced by the turn loop, so the launcher has to do it.
    expect(vi.mocked(announceCrisisStart)).toHaveBeenCalledTimes(3);
  });

  it("opens the ladder at the advisory rung", async () => {
    await openVietnamChain(asDb(db), 20, IN_WINDOW);
    const state = await getVietnamEscalation(asDb(db));
    expect(state.hasOpened).toBe(true);
    expect(state.level).toBe(1);
  });

  it("is idempotent: a second start produces no second war", async () => {
    await openVietnamChain(asDb(db), 20, IN_WINDOW);
    createCrisisFromTemplate.mockClear();

    const again = await openVietnamChain(asDb(db), 21, IN_WINDOW);
    expect(again.started).toBe(false);
    expect(again.reason).toBe("already_started");
    expect(again.crisisIds).toEqual([]);
    expect(createCrisisFromTemplate).not.toHaveBeenCalled();
  });

  it("stays stood down once the ladder has been talked to nothing", async () => {
    await openVietnamChain(asDb(db), 20, IN_WINDOW);
    await db.collection("vietnamEscalation").updateOne({ _id: "current" }, { $set: { level: 0 } });

    const again = await openVietnamChain(asDb(db), 60, IN_WINDOW);
    expect(again.started).toBe(false);
    expect(again.reason).toBe("already_started");
    expect(again.level).toBe(0);
  });

  it("refuses outside the era window and starts nothing", async () => {
    for (const year of [VIETNAM_FROM_YEAR - 1, VIETNAM_UNTIL_YEAR + 1, undefined]) {
      const result = await openVietnamChain(asDb(db), 20, year);
      expect(result.started).toBe(false);
      expect(result.reason).toBe("outside_era_window");
    }
    expect(createCrisisFromTemplate).not.toHaveBeenCalled();
    expect((await getVietnamEscalation(asDb(db))).hasOpened).toBe(false);
  });

  it("opens the boundary years themselves", async () => {
    expect((await openVietnamChain(asDb(db), 20, VIETNAM_FROM_YEAR)).started).toBe(true);
    const fresh = makeDb();
    expect((await openVietnamChain(asDb(fresh), 20, VIETNAM_UNTIL_YEAR)).started).toBe(true);
  });

  it("is the same path the turn loop takes", async () => {
    const result = await processVietnamChainOpening(asDb(db), 20, IN_WINDOW);
    expect(result.spawned).toBe(3);
    expect(vi.mocked(announceVietnamChainStart)).toHaveBeenCalledTimes(1);
  });
});
