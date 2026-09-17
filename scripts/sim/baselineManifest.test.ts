/**
 * Stateful tests for the v1 full-snapshot baseline seal (issue #1470
 * experiment-integrity closure). Every test runs a stateful fake snapshot db
 * through the SAME observe/stamp/claim/copy helpers (mirroring the
 * production scripts' method), so a green suite means the gates agree with
 * each other, not just with themselves.
 *
 * Each state below is written red-first: the mutation/race is staged, then
 * the gate must refuse with the drift named (or accept, for the stability
 * and recovery cases).
 */
import { describe, expect, it } from "vitest";
import {
  assertBaselineMarkerForClaim,
  assertBaselineStampCompatible,
  assertCopiedBaselineMatches,
  assertCopiedMarkerMatches,
  assertSourceManifestStableAcrossCopy,
  BASELINE_SEAL_VERSION,
  buildBaselineManifest,
  buildCaptureReservationDoc,
  buildSealedMarkerDoc,
  diffBaselineManifests,
  hashBaselineDocument,
  isBaselineManifestCollection,
  isSealedBaselineMarker,
  readSealedBaselineManifest,
  resolveBaselineCapture,
  stableStringifyBaseline,
  type BaselineManifest,
  type BaselineMarkerDoc,
  type BaselineObservation,
} from "./baselineManifest";

/** Minimal stateful stand-in for one sandbox snapshot db. */
class FakeSnapshotDb {
  collections = new Map<string, Array<Record<string, unknown>>>();
  marker: BaselineMarkerDoc | null = null;

  setDocs(name: string, docs: Array<Record<string, unknown>>): void {
    this.collections.set(
      name,
      docs.map((d) => JSON.parse(JSON.stringify(d)) as Record<string, unknown>)
    );
  }

  getDocs(name: string): Array<Record<string, unknown>> {
    return this.collections.get(name) ?? [];
  }

  /** Production-method observation: covered collections only, turn from gameState. */
  observe(baselineId: string): BaselineObservation {
    const docsByCollection: Record<string, unknown[]> = {};
    for (const name of [...this.collections.keys()].sort()) {
      if (!isBaselineManifestCollection(name)) continue;
      docsByCollection[name] = (this.collections.get(name) ?? []).map((d) => ({ ...d }));
    }
    const gameState = (this.collections.get("gameState") ?? []).find((d) => d._id === "current");
    return {
      baselineId,
      sourceTurn: Number((gameState as { currentTurn?: unknown } | undefined)?.currentTurn ?? 0),
      manifest: buildBaselineManifest(baselineId, docsByCollection),
    };
  }

  /** Production-method stamp: gate, then write the sealed marker. */
  stamp(baselineId: string): void {
    const observed = this.observe(baselineId);
    assertBaselineStampCompatible(this.marker, observed);
    const existing = this.marker;
    const captureId =
      existing && typeof existing.captureId === "string"
        ? (existing.captureId as string)
        : undefined;
    this.marker = buildSealedMarkerDoc(
      baselineId,
      observed.sourceTurn,
      observed.manifest,
      new Date(0),
      captureId
    ) as BaselineMarkerDoc;
  }

  /** Production-method claim: observe right now, gate against the marker. */
  claim(baselineId: string): BaselineManifest {
    return assertBaselineMarkerForClaim(this.marker, this.observe(baselineId));
  }

  /** Sandbox-to-sandbox copy: covered collections plus the marker travel. */
  copyTo(dest: FakeSnapshotDb): void {
    dest.collections.clear();
    for (const [name, docs] of this.collections) {
      if (name === "simBaselines") continue;
      dest.setDocs(
        name,
        docs.map((d) => ({ ...d }))
      );
    }
    dest.marker =
      this.marker === null ? null : (JSON.parse(JSON.stringify(this.marker)) as BaselineMarkerDoc);
  }
}

function seedWorld(db: FakeSnapshotDb): void {
  db.setDocs("gameState", [{ _id: "current", currentTurn: 10, treasury: 500 }]);
  db.setDocs("corporations", [
    { _id: "c1", output: 100, tags: ["a", "b"] },
    { _id: "c2", output: 200, tags: [] },
  ]);
  db.setDocs("countries", [{ _id: "US", approval: 55 }]);
}

describe("v1 manifest representation", () => {
  it("records per-collection counts/hashes plus a versioned overall digest", () => {
    const db = new FakeSnapshotDb();
    seedWorld(db);
    const { manifest } = db.observe("snap1");
    expect(manifest.version).toBe(BASELINE_SEAL_VERSION);
    expect(manifest.baselineId).toBe("snap1");
    expect(manifest.totalDocs).toBe(4);
    expect(manifest.collections.map((c) => [c.name, c.count])).toEqual([
      ["corporations", 2],
      ["countries", 1],
      ["gameState", 1],
    ]);
    for (const c of manifest.collections) expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across key, document, and collection ordering", () => {
    const a = buildBaselineManifest("s", {
      corporations: [
        { _id: "c1", output: 100, nested: { x: 1, y: [1, 2] } },
        { _id: "c2", output: 200 },
      ],
      gameState: [{ _id: "current", currentTurn: 10 }],
    });
    const reordered = buildBaselineManifest("s", {
      gameState: [{ currentTurn: 10, _id: "current" }],
      corporations: [
        { output: 200, _id: "c2" },
        { nested: { y: [1, 2], x: 1 }, output: 100, _id: "c1" },
      ],
    });
    expect(reordered.digest).toBe(a.digest);
    expect(diffBaselineManifests(a, reordered)).toEqual([]);
  });

  it("is stable across driver BSON representations of the same values", () => {
    const oidHex = "68c8f2a1b3d44e5f9012abcd";
    const oidBytes = Buffer.from(oidHex, "hex");
    const asDriver = {
      _id: "current",
      at: new Date("2026-09-17T00:00:00.000Z"),
      oid: { toHexString: () => oidHex },
      raw: Buffer.from("hello"),
      long: { _bsontype: "Long", toString: () => "5" },
      dec: { _bsontype: "Decimal128", toString: () => "5.0" },
    };
    const asEjson = {
      _id: "current",
      at: { $date: "2026-09-17T00:00:00.000Z" },
      oid: { $oid: oidHex },
      raw: { $binary: { base64: Buffer.from("hello").toString("base64"), subType: "00" } },
      long: { $numberLong: "5" },
      dec: { $numberDecimal: "5.0" },
    };
    const asBsonDucks = {
      _id: "current",
      at: new Date("2026-09-17T00:00:00.000Z"),
      oid: { _bsontype: "ObjectId", id: oidBytes },
      raw: { _bsontype: "Binary", buffer: oidBytes.slice(0, 5) },
      long: 5,
      dec: 5,
    };
    // Driver instance vs EJSON round-trip of the shared scalar subset.
    expect(hashBaselineDocument({ ...asDriver, raw: Buffer.from("hello") })).toBe(
      hashBaselineDocument({
        ...asEjson,
        raw: { $binary: { base64: Buffer.from("hello").toString("base64"), subType: "00" } },
      })
    );
    // ObjectId instance vs ObjectId duck with the same bytes.
    expect(stableStringifyBaseline({ oid: { toHexString: () => oidHex } })).toBe(
      stableStringifyBaseline({ oid: { _bsontype: "ObjectId", id: oidBytes } })
    );
    // Buffer vs Binary duck with the same bytes.
    expect(stableStringifyBaseline({ raw: Buffer.from("hello") })).toBe(
      stableStringifyBaseline({ raw: { _bsontype: "Binary", buffer: Buffer.from("hello") } })
    );
    // Long("5") vs safe-integer number 5 vs Decimal128("5.0").
    expect(stableStringifyBaseline({ n: { _bsontype: "Long", toString: () => "5" } })).toBe(
      stableStringifyBaseline({ n: 5 })
    );
    expect(stableStringifyBaseline(asBsonDucks)).toBe(
      stableStringifyBaseline({ ...asBsonDucks, at: new Date("2026-09-17T00:00:00.000Z") })
    );
  });

  it("excludes seal metadata, history collections, and system collections", () => {
    expect(isBaselineManifestCollection("simBaselines")).toBe(false);
    expect(isBaselineManifestCollection("actionLogs")).toBe(false);
    expect(isBaselineManifestCollection("system.indexes")).toBe(false);
    expect(isBaselineManifestCollection("corporations")).toBe(true);
    const db = new FakeSnapshotDb();
    seedWorld(db);
    const before = db.observe("s").manifest.digest;
    // Seal metadata, history noise, and an un-stamped-then-stamped marker
    // never perturb the digest (the old seal counted simBaselines itself).
    db.setDocs("simBaselines", [{ _id: "s", sourceTurn: 10 }]);
    db.setDocs("actionLogs", [{ _id: "l1", msg: "noise" }]);
    db.marker = { _id: "s", sourceTurn: 10 };
    expect(db.observe("s").manifest.digest).toBe(before);
  });
});

describe("in-place and structural drift (the old seal's blind spots)", () => {
  it("trips on an in-place non-gameState edit with turn and counts unchanged", () => {
    // Red-first: same turn, same per-collection counts, one field changed in
    // corporations. The old turn+count seal (and even the gameState-only
    // hash) accepted this; the manifest names the collection.
    const db = new FakeSnapshotDb();
    seedWorld(db);
    db.stamp("snap1");
    expect(() => db.claim("snap1")).not.toThrow();

    const corps = db.getDocs("corporations");
    corps[0].output = 999999;
    expect(() => db.claim("snap1")).toThrow(/corporations.*content hash changed/);
    // gameState untouched: a gameState-only seal would still pass here.
    expect(db.getDocs("gameState")).toEqual([{ _id: "current", currentTurn: 10, treasury: 500 }]);
  });

  it("names added and removed collections exactly", () => {
    const db = new FakeSnapshotDb();
    seedWorld(db);
    db.stamp("snap1");

    db.setDocs("newCollectors", [{ _id: "n1" }]);
    expect(() => db.claim("snap1")).toThrow(/collection "newCollectors" added with 1 docs/);

    db.collections.delete("newCollectors");
    db.collections.delete("countries");
    expect(() => db.claim("snap1")).toThrow(
      /collection "countries" removed \(sealed with 1 docs\)/
    );
  });

  it("trips on count drift with content otherwise identical", () => {
    const db = new FakeSnapshotDb();
    seedWorld(db);
    db.stamp("snap1");
    const corps = db.getDocs("corporations");
    corps.push({ _id: "c3", output: 300, tags: [] });
    expect(() => db.claim("snap1")).toThrow(/collection "corporations" count 2->3/);
  });

  it("re-stamps the identical observation and refuses a mutated re-stamp", () => {
    const db = new FakeSnapshotDb();
    seedWorld(db);
    db.stamp("snap1");
    const same = db.observe("snap1");
    expect(() => assertBaselineStampCompatible(db.marker, same)).not.toThrow();

    const advanced = db.observe("snap1");
    advanced.sourceTurn = 11;
    expect(() => assertBaselineStampCompatible(db.marker, advanced)).toThrow(
      /turn 10->11.*refusing to re-stamp a mutated snapshot/
    );
    const mutatedManifest: BaselineManifest = {
      ...same.manifest,
      collections: same.manifest.collections.map((c) =>
        c.name === "countries" ? { ...c, count: c.count + 1 } : c
      ),
    };
    expect(() =>
      assertBaselineStampCompatible(db.marker, { ...same, manifest: mutatedManifest })
    ).toThrow(/collection "countries" count/);
  });
});

describe("exclusive first capture (same-baselineId concurrency)", () => {
  /** Marker-store stand-in: duplicate _ids surface as code-11000 errors. */
  class FakeMarkerStore {
    docs = new Map<string, BaselineMarkerDoc>();
    async insert(doc: BaselineMarkerDoc): Promise<void> {
      const id = String(doc._id);
      if (this.docs.has(id)) {
        const err = new Error(`E11000 duplicate key: { _id: "${id}" }`) as Error & {
          code: number;
        };
        err.code = 11000;
        throw err;
      }
      this.docs.set(id, { ...doc });
    }
    get(id: string): BaselineMarkerDoc | null {
      return this.docs.get(id) ?? null;
    }
  }

  async function capture(
    store: FakeMarkerStore,
    baselineId: string,
    captureId: string
  ): Promise<"proceed" | "resume"> {
    try {
      await store.insert(
        buildCaptureReservationDoc(baselineId, captureId, new Date(0)) as BaselineMarkerDoc
      );
      return "proceed";
    } catch (err) {
      if (typeof err !== "object" || err === null || (err as { code?: unknown }).code !== 11000) {
        throw err;
      }
      return resolveBaselineCapture(store.get(baselineId), captureId);
    }
  }

  it("serializes concurrent first captures: loser refuses, same id resumes, sealed refuses", async () => {
    const store = new FakeMarkerStore();
    expect(await capture(store, "live-1", "cap-A")).toBe("proceed");
    // Concurrent competitor with another id refuses (nothing overwritten).
    await expect(capture(store, "live-1", "cap-B")).rejects.toThrow(/already in progress.*cap-A/);
    // Crashed capturer retrying with the same id resumes.
    expect(await capture(store, "live-1", "cap-A")).toBe("resume");
    // Once sealed, even the holding captureId cannot recapture the same id.
    const db = new FakeSnapshotDb();
    seedWorld(db);
    db.marker = store.get("live-1");
    db.stamp("live-1");
    store.docs.set("live-1", db.marker);
    await expect(capture(store, "live-1", "cap-A")).rejects.toThrow(/already sealed/);
    await expect(capture(store, "live-1", "cap-B")).rejects.toThrow(/already sealed/);
  });

  it("recovers a crash during capture/seal without ever letting an arm claim", async () => {
    const store = new FakeMarkerStore();
    const db = new FakeSnapshotDb();
    seedWorld(db);
    // Capture half-done: reservation held, clone incomplete, never sealed.
    expect(await capture(store, "live-9", "cap-crash")).toBe("proceed");
    db.marker = store.get("live-9");
    // An arm must not claim the unsealed baseline (fail closed, with resume guidance).
    expect(() => db.claim("live-9")).toThrow(/capture is incomplete.*same --capture-id/);
    // Supervisor resumes with the same id, finishes the clone, seals.
    expect(await capture(store, "live-9", "cap-crash")).toBe("resume");
    db.stamp("live-9");
    store.docs.set("live-9", db.marker);
    expect(isSealedBaselineMarker(store.get("live-9") as BaselineMarkerDoc)).toBe(true);
    expect(() => db.claim("live-9")).not.toThrow();
  });
});

describe("claim-to-copy race narrowing", () => {
  it("fails closed when the source mutates during the copy", () => {
    const source = new FakeSnapshotDb();
    seedWorld(source);
    source.stamp("snap9");
    // Pre-copy check passes: the seal describes the source right now.
    const sealed = source.claim("snap9");

    // The copy reads state, then the source mutates mid-copy: the dest
    // faithfully lands the MUTATED state with the unchanged marker.
    const dest = new FakeSnapshotDb();
    const corps = source.getDocs("corporations");
    corps[1].output = 777;
    source.copyTo(dest);

    // Marker travel alone accepts this (marker copied unchanged): the
    // source-stability gate is what fails closed, naming the collection.
    expect(() => assertCopiedMarkerMatches(source.marker, dest.marker, "snap9")).not.toThrow();
    expect(() =>
      assertSourceManifestStableAcrossCopy(sealed, source.observe("snap9"), "snap9")
    ).toThrow(/source changed during the copy.*corporations/);
    // And the dest-state gate fails too: landed state no longer matches the seal.
    expect(() =>
      assertCopiedBaselineMatches(source.marker, dest.marker, dest.observe("snap9"), "snap9")
    ).toThrow(/corporations/);
  });

  it("accepts a faithful copy end to end and refuses dest mismatch", () => {
    const source = new FakeSnapshotDb();
    seedWorld(source);
    source.stamp("snap9");
    const sealed = source.claim("snap9");

    const dest = new FakeSnapshotDb();
    source.copyTo(dest);
    expect(() =>
      assertSourceManifestStableAcrossCopy(sealed, source.observe("snap9"), "snap9")
    ).not.toThrow();
    expect(() =>
      assertCopiedBaselineMatches(source.marker, dest.marker, dest.observe("snap9"), "snap9")
    ).not.toThrow();

    // Landed without the marker (copy dropped the collection): refuse.
    expect(() => assertCopiedMarkerMatches(source.marker, null, "snap9")).toThrow(/without its/);
    // Dest state edited after landing (turn runner touched the arm db).
    dest.getDocs("countries")[0].approval = 1;
    expect(() =>
      assertCopiedBaselineMatches(source.marker, dest.marker, dest.observe("snap9"), "snap9")
    ).toThrow(/countries/);
    // Dest marker from another baseline (copied the wrong source).
    const other = { ...(dest.marker as BaselineMarkerDoc), _id: "other" };
    expect(() => assertCopiedMarkerMatches(source.marker, other, "snap9")).toThrow(
      /diverges|forked/
    );
  });
});

describe("legacy weak markers", () => {
  it("refuses claim on a legacy seal and upgrades it on re-stamp", () => {
    const db = new FakeSnapshotDb();
    seedWorld(db);
    // Pre-manifest marker shape: turn + estimated count + gameState hash only.
    db.marker = { _id: "legacy1", sourceTurn: 10, docCount: 4, stateHash: "0".repeat(64) };
    expect(() => db.claim("legacy1")).toThrow(/legacy weak seal.*re-stamp/);
    // The next stamp with the current stamper upgrades to v1 (ground truth
    // becomes the fresh manifest; the weak fields are dropped).
    db.stamp("legacy1");
    expect(isSealedBaselineMarker(db.marker as BaselineMarkerDoc)).toBe(true);
    expect((db.marker as { docCount?: unknown }).docCount).toBeUndefined();
    expect((db.marker as { stateHash?: unknown }).stateHash).toBeUndefined();
    expect(() => db.claim("legacy1")).not.toThrow();
    expect(() => readSealedBaselineManifest(db.marker, "legacy1")).not.toThrow();
  });

  it("refuses claim on a missing marker and an overwritten marker", () => {
    const db = new FakeSnapshotDb();
    seedWorld(db);
    expect(() => db.claim("nope")).toThrow(/has no simBaselines marker/);
    db.stamp("snap1");
    db.marker = { ...(db.marker as BaselineMarkerDoc), _id: "other" };
    expect(() => db.claim("snap1")).toThrow(/identity mismatch/);
  });
});
