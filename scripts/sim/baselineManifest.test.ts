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
  assertArmFenceMarker,
  assertBaselineDigestFlag,
  assertBaselineMarkerForClaim,
  assertBaselineStampCompatible,
  assertCopiedBaselineMatches,
  assertCopiedMarkerMatches,
  assertSourceManifestStableAcrossCopy,
  BASELINE_MANIFEST_MAX_DOCS,
  BASELINE_MANIFEST_MAX_DOCS_PER_COLLECTION,
  BASELINE_SEAL_VERSION,
  buildBaselineManifest,
  buildCaptureReservationDoc,
  buildSealedMarkerDoc,
  createStreamingManifestBuilder,
  diffBaselineManifests,
  hashBaselineDocument,
  isBaselineManifestCollection,
  isSealedBaselineMarker,
  observeBaselineSnapshot,
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

describe("canonicalization across driver forms (review #1968)", () => {
  it("hashes non-finite numbers and -0 identically across native, BSON, and EJSON forms", () => {
    for (const raw of ["NaN", "Infinity", "-Infinity"]) {
      const ejson = stableStringifyBaseline({ n: { $numberDouble: raw } });
      expect(stableStringifyBaseline({ n: Number(raw) })).toBe(ejson);
      expect(stableStringifyBaseline({ n: { _bsontype: "Double", toString: () => raw } })).toBe(
        ejson
      );
    }
    expect(stableStringifyBaseline({ n: { $numberDouble: "-0" } })).toBe(
      stableStringifyBaseline({ n: -0 })
    );
    expect(stableStringifyBaseline({ n: { _bsontype: "Decimal128", toString: () => "NaN" } })).toBe(
      stableStringifyBaseline({ n: NaN })
    );
  });

  it("tags native RegExp by source+flags instead of conflating with {}", () => {
    expect(stableStringifyBaseline({ r: /abc/i })).toBe(
      stableStringifyBaseline({ r: { _bsontype: "BSONRegExp", pattern: "abc", options: "i" } })
    );
    expect(stableStringifyBaseline({ r: /abc/i })).not.toBe(stableStringifyBaseline({ r: /xyz/ }));
    expect(stableStringifyBaseline({ r: /abc/i })).not.toBe(stableStringifyBaseline({ r: {} }));
  });

  it("distinguishes Binary subtypes while keeping Buffer == subtype-0 == EJSON 00", () => {
    const hello = Buffer.from("hello");
    const b64 = hello.toString("base64");
    // Same bytes, generic binary: all three forms agree.
    expect(
      stableStringifyBaseline({ b: { _bsontype: "Binary", buffer: hello, sub_type: 0 } })
    ).toBe(stableStringifyBaseline({ b: hello }));
    expect(stableStringifyBaseline({ b: { $binary: { base64: b64, subType: "00" } } })).toBe(
      stableStringifyBaseline({ b: hello })
    );
    // UUID bytes (subtype 4) never conflate with generic binary.
    expect(
      stableStringifyBaseline({ b: { _bsontype: "Binary", buffer: hello, sub_type: 4 } })
    ).not.toBe(stableStringifyBaseline({ b: hello }));
    // EJSON hex subtype agrees with the driver integer subtype.
    expect(stableStringifyBaseline({ b: { $binary: { base64: b64, subType: "04" } } })).toBe(
      stableStringifyBaseline({ b: { _bsontype: "Binary", buffer: hello, sub_type: 4 } })
    );
  });

  it("refuses a legacy-marker recapture with upgrade guidance (not resume guidance)", () => {
    expect(() =>
      resolveBaselineCapture({ _id: "legacy", sourceTurn: 3, docCount: 9, stateHash: "x" }, "cap-X")
    ).toThrow(/legacy weak seal.*re-stamp/);
  });

  describe("streaming v2 observation (scalability closure)", () => {
    /** Batched async-iterable cursor over an array (production shape, tiny). */
    async function* batched(docs: unknown[], batch: number): AsyncIterable<unknown> {
      for (let i = 0; i < docs.length; i += batch) yield* docs.slice(i, i + batch);
    }

    function doc(i: number): Record<string, unknown> {
      return { _id: `d${i}`, n: i, payload: `value-${i}` };
    }

    it("aborts on the exact doc that trips the per-collection ceiling mid-iteration", () => {
      const builder = createStreamingManifestBuilder("s", {
        maxDocsPerCollection: 3,
        maxDocs: 100,
      });
      builder.add("corporations", doc(1));
      builder.add("corporations", doc(2));
      builder.add("corporations", doc(3));
      expect(builder.countFor("corporations")).toBe(3);
      // The 4th doc trips DURING iteration: nothing was buffered past it, and
      // the builder refuses to finish or continue afterwards.
      expect(() => builder.add("corporations", doc(4))).toThrow(
        /collection "corporations" holds more than 3 docs \(4 and counting\)/
      );
      expect(() => builder.finish()).toThrow(/refusing to finish a failed build/);
      expect(() => builder.add("corporations", doc(5))).toThrow(/already failed/);
    });

    it("aborts on the exact doc that trips the global ceiling across collections", () => {
      const builder = createStreamingManifestBuilder("s", {
        maxDocsPerCollection: 100,
        maxDocs: 4,
      });
      builder.add("a", doc(1));
      builder.add("a", doc(2));
      builder.add("b", doc(3));
      builder.add("b", doc(4));
      expect(builder.totalDocs()).toBe(4);
      // 2+2 fits each collection cap but the 5th doc trips the global bound.
      expect(() => builder.add("c", doc(5))).toThrow(/holds more than 4 docs \(5 and counting\)/);
      expect(() => builder.finish()).toThrow(/refusing to finish a failed build/);
    });

    it("streams large batched input with O(batch) retention and matches the one-shot build", async () => {
      const big = Array.from({ length: 5000 }, (_, i) => doc(i));
      const small = Array.from({ length: 700 }, (_, i) => ({ _id: `s${i}`, v: i % 7 }));
      const names = ["corporations", "gameState"];
      // Forward order, small batches, interleaved differently per collection.
      const streamed = await observeBaselineSnapshot("s", names, (name) =>
        batched(name === "corporations" ? big : small, 64)
      );
      const oneShot = buildBaselineManifest("s", { corporations: big, gameState: small });
      expect(streamed.digest).toBe(oneShot.digest);
      expect(streamed.totalDocs).toBe(5700);
      // Reverse arrival order and reversed collection order: identical digest,
      // so no DB-side sort is needed for determinism.
      const reversed = await observeBaselineSnapshot("s", [...names].reverse(), (name) =>
        batched([...(name === "corporations" ? big : small)].reverse(), 37)
      );
      expect(reversed.digest).toBe(oneShot.digest);
      expect(reversed.collections).toEqual(streamed.collections);
    });

    it("is order-independent under arbitrary interleaving, not just reversal", () => {
      const docs = Array.from({ length: 200 }, (_, i) => doc(i));
      const builderA = createStreamingManifestBuilder("s");
      for (const d of docs) builderA.add("c", d);
      // Deterministic shuffle (FNV-style, no Math.random: the manifest must
      // never depend on ambient randomness).
      const shuffled = [...docs];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = (i * 2654435761 + 97) % (i + 1);
        const tmp = shuffled[i] as Record<string, unknown>;
        shuffled[i] = shuffled[j] as Record<string, unknown>;
        shuffled[j] = tmp;
      }
      const builderB = createStreamingManifestBuilder("s");
      for (const d of shuffled) builderB.add("c", d);
      expect(builderB.finish().digest).toBe(builderA.finish().digest);
    });

    it("handles mixed _id types deterministically (no BSON sort needed)", async () => {
      const docs: unknown[] = [
        { _id: 3, v: "num" },
        { _id: "3", v: "str" },
        { _id: null, v: "nil" },
        { v: "missing" },
        { _id: { toHexString: () => "68c8f2a1b3d44e5f9012abcd" }, v: "oid" },
        {
          _id: { _bsontype: "ObjectId", id: Buffer.from("68c8f2a1b3d44e5f9012abcd", "hex") },
          v: "oid-duck",
        },
        { _id: true, v: "bool" },
        { _id: new Date("2026-09-17T00:00:00.000Z"), v: "date" },
        { _id: { nested: [1, { x: 2 }] }, v: "obj" },
      ];
      const first = await observeBaselineSnapshot("mix", ["c"], (name) =>
        batched(name === "c" ? docs : [], 3)
      );
      const second = await observeBaselineSnapshot("mix", ["c"], (name) =>
        batched(name === "c" ? [...docs].reverse() : [], 4)
      );
      expect(first.digest).toBe(second.digest);
      expect(first.totalDocs).toBe(docs.length);
      // The ObjectId instance and its duck form canonicalize identically, so
      // they MUST both count even though they hash the same: count binding
      // (not digest uniqueness) is what distinguishes them from one copy.
      expect(first.collections).toHaveLength(1);
      expect(first.collections[0]?.count).toBe(docs.length);
    });

    it("counts duplicate canonical docs (additive, no XOR cancellation)", () => {
      const a = { _id: "x", out: { p: 1, q: [1, 2] } };
      const aReordered = { out: { q: [1, 2], p: 1 }, _id: "x" };
      const single = buildBaselineManifest("s", { c: [a] });
      const doubled = buildBaselineManifest("s", { c: [a, aReordered] });
      // Same canonical content twice: count 2, and a DIFFERENT digest than
      // one copy (an XOR-fold would cancel to the empty digest here).
      expect(doubled.totalDocs).toBe(2);
      expect(doubled.digest).not.toBe(single.digest);
      const empty = buildBaselineManifest("s", { c: [] });
      expect(doubled.digest).not.toBe(empty.digest);
      // And the pair still hashes order-independently.
      expect(buildBaselineManifest("s", { c: [aReordered, a] }).digest).toBe(doubled.digest);
    });

    it("propagates a mid-iteration cursor failure with no partial manifest", async () => {
      async function* failing(): AsyncIterable<unknown> {
        yield doc(1);
        yield doc(2);
        throw new Error("cursor died at batch 2");
      }
      await expect(observeBaselineSnapshot("s", ["c"], () => failing())).rejects.toThrow(
        "cursor died at batch 2"
      );
      // A cursor that fails on open aborts before any doc is hashed.
      await expect(
        observeBaselineSnapshot("s", ["c"], () => {
          throw new Error("open failed");
        })
      ).rejects.toThrow("open failed");
    });
  });

  describe("v1 to v2 compatibility (fail closed, upgrade on re-stamp)", () => {
    // Hand-built sealed v1 marker: what a pre-streaming stamper wrote.
    function v1SealedMarker(): BaselineMarkerDoc {
      const v1 = { ...buildBaselineManifest("v1snap", { gameState: [{ _id: "current" }] }) };
      return {
        _id: "v1snap",
        baselineId: "v1snap",
        sealVersion: 1,
        status: "sealed",
        sourceTurn: 10,
        manifest: { ...v1, version: 1 as never },
        totalDocs: v1.totalDocs,
        digest: v1.digest,
      };
    }

    it("refuses claim on a sealed v1 marker with re-stamp (not legacy) guidance", () => {
      const db = new FakeSnapshotDb();
      seedWorld(db);
      db.marker = v1SealedMarker();
      expect(() => db.claim("v1snap")).toThrow(/sealed v1 manifest.*re-stamp/);
      expect(() => readSealedBaselineManifest(db.marker, "v1snap")).toThrow(/sealed v1 manifest/);
      expect(isSealedBaselineMarker(db.marker)).toBe(false);
    });

    it("upgrades a sealed v1 marker on the next stamp and claims afterwards", () => {
      const db = new FakeSnapshotDb();
      seedWorld(db);
      db.marker = v1SealedMarker();
      // The first v2 seal always lands (no drift check against v1 digests,
      // which can never compare equal); ground truth becomes the fresh seal.
      db.stamp("v1snap");
      expect(isSealedBaselineMarker(db.marker as BaselineMarkerDoc)).toBe(true);
      expect((db.marker as { sealVersion?: unknown }).sealVersion).toBe(BASELINE_SEAL_VERSION);
      expect(() => db.claim("v1snap")).not.toThrow();
    });

    it("names the version drift when a v1 and a v2 manifest are diffed", () => {
      const v1 = {
        ...buildBaselineManifest("s", { c: [{ _id: 1 }] }),
        version: 1 as never,
      };
      const v2 = buildBaselineManifest("s", { c: [{ _id: 1 }] });
      expect(diffBaselineManifests(v1, v2)).toContainEqual(
        expect.stringMatching(/seal version 1->2.*re-stamp/)
      );
    });

    it("refuses a sealed-v1 recapture as already sealed", () => {
      expect(() => resolveBaselineCapture(v1SealedMarker(), "cap-X")).toThrow(/already sealed/);
    });

    it("exposes the production ceilings as constants", () => {
      expect(BASELINE_MANIFEST_MAX_DOCS).toBe(5_000_000);
      expect(BASELINE_MANIFEST_MAX_DOCS_PER_COLLECTION).toBe(1_000_000);
    });
  });

  describe("pre-spawn arm fence (R3 narrowing)", () => {
    function sealedMarkerFor(baselineId: string): { marker: BaselineMarkerDoc; digest: string } {
      const manifest = buildBaselineManifest(baselineId, {
        gameState: [{ _id: "current", currentTurn: 10 }],
      });
      const marker = buildSealedMarkerDoc(
        baselineId,
        10,
        manifest,
        new Date(0)
      ) as BaselineMarkerDoc;
      return { marker, digest: manifest.digest };
    }

    it("accepts the worker-verified digest and validates the flag shape", () => {
      const { marker, digest } = sealedMarkerFor("arm1");
      expect(() => assertArmFenceMarker(marker, "arm1", digest)).not.toThrow();
      expect(assertBaselineDigestFlag(digest)).toBe(digest);
      expect(() => assertBaselineDigestFlag("xyz")).toThrow(/64-hex/);
      expect(() => assertBaselineDigestFlag("")).toThrow(/64-hex/);
    });

    it("refuses a final pre-spawn marker mutation of the arm db", () => {
      const { marker, digest } = sealedMarkerFor("arm1");
      // The worker verified `digest`; then a write lands in the arm db and the
      // copy's marker is re-sealed over mutated state (or the wrong marker
      // travels): the fence sees a digest it never verified.
      const mutated = buildBaselineManifest("arm1", {
        gameState: [{ _id: "current", currentTurn: 10, treasury: 1 }],
      });
      const mutatedMarker = {
        ...marker,
        manifest: mutated,
        digest: mutated.digest,
      } as BaselineMarkerDoc;
      expect(() => assertArmFenceMarker(mutatedMarker, "arm1", digest)).toThrow(
        /changed after the verified copy/
      );
    });

    it("documents the marker-only boundary: state drift with an intact marker passes the fence", () => {
      const { marker, digest } = sealedMarkerFor("arm1");
      // The fence takes no state input: it proves the worker-verified seal is
      // still the seal the arm carries, not that arm state still matches the
      // seal. A state-only write preserving the marker (supervisor poke into
      // a state collection, second arm sharing the db writing state but not
      // the seal) is invisible here by design; only a full re-observation
      // (the worker's pre/post-copy checks) sees state drift. The irreducible
      // window for such a mutation runs from the worker's post-copy dest
      // observation to the first turn write.
      expect(() => assertArmFenceMarker(marker, "arm1", digest)).not.toThrow();
      // The digest string IS the seal: even a marker whose embedded
      // collection list no longer describes anything passes while the digest
      // matches (the list is diagnosis, compared by the full checks only).
      const gutted = {
        ...marker,
        manifest: { ...(marker.manifest as object), collections: [] },
      } as BaselineMarkerDoc;
      expect(isSealedBaselineMarker(gutted)).toBe(true);
      expect(() => assertArmFenceMarker(gutted, "arm1", digest)).not.toThrow();
    });

    it("refuses a missing, unsealed, or foreign marker at spawn", () => {
      const { marker, digest } = sealedMarkerFor("arm1");
      expect(() => assertArmFenceMarker(null, "arm1", digest)).toThrow(/no simBaselines marker/);
      expect(() => assertArmFenceMarker(undefined, "arm1", digest)).toThrow(
        /no simBaselines marker/
      );
      expect(() =>
        assertArmFenceMarker({ ...marker, status: "capturing" }, "arm1", digest)
      ).toThrow(/not a sealed v2 seal/);
      expect(() => assertArmFenceMarker({ ...marker, _id: "other" }, "arm1", digest)).toThrow(
        /identity mismatch/
      );
      expect(() => assertArmFenceMarker({ ...marker, sealVersion: 1 }, "arm1", digest)).toThrow(
        /not a sealed v2 seal/
      );
    });
  });

  it("names an unknown capture holder instead of printing undefined", () => {
    expect(() => resolveBaselineCapture({ _id: "b", status: "capturing" }, "cap-X")).toThrow(
      /an unknown holder/
    );
    expect(() => readSealedBaselineManifest({ _id: "b", status: "capturing" }, "b")).toThrow(
      /an unknown holder/
    );
  });
});
