/**
 * Versioned full-snapshot seal for paired-baseline sandbox snapshots
 * (issue #1470 experiment-integrity closure).
 *
 * The previous seal (gameState turn + estimated doc count + gameState-only
 * content hash) could not see an in-place edit to any other collection, a
 * collection add/drop that preserved the total count, or any drift hidden
 * behind the estimate. This module replaces it with a deterministic
 * full-snapshot manifest covering every cloned collection and document:
 *
 * - Coverage: exactly the cloneWorld copy set (every non-system collection
 *   except the append-only history/log set below and the simBaselines seal
 *   metadata itself). cloneWorld.ts imports the exclusion set from here so
 *   copy and seal can never disagree on what "the snapshot" is.
 * - Stability: objects hash with sorted keys, documents fold commutatively
 *   within each collection (arrival order never counts, no DB sort needed),
 *   collections sort by name in the final digest, and BSON extras
 *   canonicalize (Date/ObjectId/Binary+subtype/Long/Decimal/Timestamp/
 *   RegExp/etc. by value, non-finite numbers kind-agnostically, including
 *   EJSON forms), so key order, doc order, collection order, and driver
 *   representation never count as drift.
 * - Diagnosis: per-collection {name, count, hash} plus one overall versioned
 *   digest. Claim and post-copy checks report exactly which collection
 *   drifted (added/removed/count/hash) instead of a bare mismatch.
 *
 * Cost (explicit and bounded): building a manifest streams one batch cursor
 * per covered collection through a per-collection 32-byte additive digest,
 * so memory is O(batch + covered collections), never O(snapshot docs).
 * Observers must feed docs through createStreamingManifestBuilder (or the
 * observeBaselineSnapshot cursor driver), never accumulate a
 * docsByCollection array: buildBaselineManifest exists only as a thin
 * small-input wrapper over the same builder. It runs ONLY on the one-time
 * baseline capture path (stampBaseline.ts: one scan) and the baselined
 * arm-claim path (worker.ts: pre-copy source scan, post-copy source
 * re-scan, post-copy dest scan). Ordinary unpaired turns and
 * fresh-bootstrap pairs never build a manifest. The global doc ceiling
 * (BASELINE_MANIFEST_MAX_DOCS) and the per-collection ceiling
 * (BASELINE_MANIFEST_MAX_DOCS_PER_COLLECTION) are enforced inside the
 * builder DURING iteration, so a pathological collection aborts on the
 * doc that trips the bound instead of after the worker buffered millions
 * of docs.
 *
 * Capture exclusivity: the first capture of a baselineId writes a durable
 * `capturing` reservation into the destination db's simBaselines collection
 * BEFORE any --drop (Mongo _id uniqueness serializes concurrent first
 * captures). resolveBaselineCapture rejects a sealed same-id recapture and
 * a competing captureId, and resumes the same captureId (crash retry).
 * Only a `sealed` marker (clone + manifest written by stampBaseline.ts) lets
 * an arm claim; `capturing`, missing, and legacy weak markers fail closed.
 *
 * Pure: no Mongo, no env, no clock. Scripts own all I/O; everything here is
 * unit-testable over plain records.
 */

import { createHash } from "crypto";

/**
 * Seal representation version. Claim rejects any other version fail-closed.
 *
 * v2 replaces the v1 per-collection digest (sha256 over the SORTED doc-hash
 * list, which forced observers to buffer every doc hash before hashing)
 * with an incremental commutative digest: each doc hash adds into a
 * per-collection 256-bit sum (mod 2^256), and the collection hash binds
 * name + count + sum. Any arrival order yields the identical digest, so
 * observers stream with O(batch) memory. Sealed v1 markers fail closed at
 * claim with re-stamp guidance and upgrade on the next stamp; v1 digests
 * never compare equal to v2 digests (distinct domain separators).
 */
export const BASELINE_SEAL_VERSION = 2;

/** Marker collection inside a baseline snapshot db. Seal metadata, not world
 * state: excluded from the manifest so stamping never perturbs the seal. */
export const BASELINE_MARKER_COLLECTION = "simBaselines";

/**
 * Append-only history, telemetry, audit and ops collections the turn engine
 * never reads. Everything NOT listed here (and not simBaselines/system.*) is
 * both copied by cloneWorld.ts and sealed by the manifest. When in doubt a
 * collection is covered: a stale extra collection is inert, a missing one can
 * break the engine mid-run. Owned here (not in cloneWorld.ts) so copy and
 * seal share one canonical coverage list.
 */
export const BASELINE_CLONE_EXCLUDED_COLLECTIONS: ReadonlySet<string> = new Set([
  "actionAuditLog",
  "actionLogs",
  "activityLog",
  "adminLog",
  "adminLogs",
  "apiAbuseScans",
  "apiAccessLog",
  "bondHistory",
  "botApiRequestLog",
  "capitalActionLogs",
  "code_sessions",
  "corporationHistory",
  "corporationPortfolioHistory",
  "daily_reports",
  "discord_ideas",
  "discord_ingest_state",
  "discord_messages",
  "discord_themes",
  "financialTxLog",
  "fix_sessions",
  "healBackups",
  "healRuns",
  "indexFundSnapshots",
  "indexFundTransactions",
  "knowledge_query_log",
  "ledgerEntries",
  "ledgerReconciliations",
  "modAuditLog",
  "moneySupplySnapshots",
  "notifications",
  "ops_knowledge",
  "ops_qa_log",
  "orgRegLedger",
  "partyHistory",
  "partyPoliticalStrengthLedger",
  "playerMail",
  "portfolioHistory",
  "pr_reviews",
  "primarySnapshots",
  "qa_memory",
  "shareTradeHistory",
  "siteTrafficPageviews",
  "statePartyElections",
  "tradeHistory",
  "treasuryTransactions",
  "wealthListHistory",
  "wireEvents",
]);

/** True when a collection belongs to the sealed snapshot (and the clone). */
export function isBaselineManifestCollection(name: string): boolean {
  return (
    !name.startsWith("system.") &&
    name !== BASELINE_MARKER_COLLECTION &&
    !BASELINE_CLONE_EXCLUDED_COLLECTIONS.has(name)
  );
}

/**
 * Hard ceiling on total sealed docs. A live-world snapshot is far below this;
 * tripping it means the coverage list is wrong (or the world grew past the
 * audited bound), and failing closed beats scanning unbounded on the box.
 * Enforced inside the streaming builder DURING iteration.
 */
export const BASELINE_MANIFEST_MAX_DOCS = 5_000_000;

/**
 * Hard ceiling on docs in any ONE collection. A single pathological
 * collection (unbounded log leaking into the coverage list, runaway
 * duplication) must abort on its own before it can exhaust the worker even
 * when the global ceiling is still far away. A live-world snapshot holds
 * tens of thousands of docs in its largest covered collection; a million is
 * already two orders of magnitude of headroom. Enforced during iteration.
 */
export const BASELINE_MANIFEST_MAX_DOCS_PER_COLLECTION = 1_000_000;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function base64OfBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function hexOfBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");
}

/** Canonical scalar tag for one BSON numeric value held as a decimal string. */
function canonicalNumberToken(raw: string, kind: string): string {
  const n = Number(raw);
  // Non-finite values and -0 carry no kind-distinguishing payload worth
  // keeping: Double(NaN), Decimal128(NaN), and EJSON $numberDouble "NaN" are
  // the same logical value as native NaN (likewise infinities and -0), so
  // they share one kind-agnostic tag and never read as drift across forms.
  if (Object.is(n, -0)) return "number:0";
  if (Number.isNaN(n)) return "number:NaN";
  if (n === Infinity) return "number:Infinity";
  if (n === -Infinity) return "number:-Infinity";
  if (Number.isSafeInteger(n) && String(n) === raw.replace(/^\+/, "").replace(/\.0+$/, "")) {
    return `number:${n}`;
  }
  if (Number.isFinite(n) && String(n) === raw) return `number:${raw}`;
  return `${kind}:${raw}`;
}

/**
 * Normalized Binary subtype: driver integer sub_type values pass through,
 * EJSON hex strings (e.g. "04") parse as hex, everything else defaults to
 * generic-binary 0 so a plain Buffer and a subtype-0 Binary stay the same
 * value while a UUID (subtype 4) never conflates with one.
 */
function canonicalBinarySubType(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number.parseInt(value, 16);
    if (Number.isInteger(parsed)) return parsed;
  }
  return 0;
}

/** Owner label for refusal messages: a missing holder prints as unknown
 * instead of the literal "undefined" (a capturing marker without a captureId
 * is hand-written or pre-reservation, not resumable). */
function formatCaptureHolder(holder: unknown): string {
  return typeof holder === "string" ? JSON.stringify(holder) : "an unknown holder";
}

/**
 * Canonical form of any BSON/JSON value. Object keys sort (order never
 * counts); arrays keep order (element order is data); BSON extras reduce to
 * value tags so driver representations (ObjectId instance vs EJSON {$oid},
 * Buffer vs Binary, Long vs safe-integer number, Date vs {$date}) hash
 * identically. Unknown shapes fall back to JSON's own serialization.
 */
export function canonicalizeBaselineValue(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return "undefined:undefined";
  if (typeof value === "number") {
    if (Object.is(value, -0)) return "number:0";
    if (!Number.isFinite(value)) return `number:${String(value)}`;
    return `number:${value}`;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (Array.isArray(value)) return value.map(canonicalizeBaselineValue);
  // Native RegExp (in-process construction only; the driver decodes BSON
  // regex as BSONRegExp): tag source+flags so distinct patterns never
  // conflate with each other or with an empty object.
  if (value instanceof RegExp) return `regexp:${value.source}:${value.flags}`;
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    // Node Buffer / Uint8Array: raw bytes by base64.
    if (Buffer.isBuffer(value)) return `buffer:0:${(value as Buffer).toString("base64")}`;
    if (value instanceof Uint8Array) return `buffer:0:${base64OfBytes(value)}`;
    // ObjectId instances (duck-typed: no bson import in the rules zone).
    if (typeof rec.toHexString === "function") {
      try {
        return `oid:${String((rec.toHexString as () => unknown)())}`;
      } catch {
        return "oid:unreadable";
      }
    }
    const bsontype = typeof rec._bsontype === "string" ? rec._bsontype : undefined;
    if (bsontype) {
      try {
        switch (bsontype) {
          case "ObjectId":
          case "ObjectID":
            if (typeof rec.toHexString === "function")
              return `oid:${String((rec.toHexString as () => unknown)())}`;
            if (rec.id instanceof Uint8Array) return `oid:${hexOfBytes(rec.id as Uint8Array)}`;
            return `oid:${JSON.stringify(rec.id ?? null)}`;
          case "Long":
          case "Int":
          case "Int32":
          case "Double":
            if (typeof rec.toString === "function" && rec.toString !== Object.prototype.toString)
              return canonicalNumberToken(String(rec.toString()), bsontype.toLowerCase());
            break;
          case "Decimal128":
            if (typeof rec.toString === "function" && rec.toString !== Object.prototype.toString)
              return canonicalNumberToken(String(rec.toString()), "decimal");
            break;
          case "Binary": {
            const sub = canonicalBinarySubType(
              (rec.sub_type as unknown) ?? (rec.subtype as unknown)
            );
            if (rec.buffer instanceof Uint8Array)
              return `buffer:${sub}:${base64OfBytes(rec.buffer)}`;
            if (Buffer.isBuffer(rec.buffer))
              return `buffer:${sub}:${(rec.buffer as Buffer).toString("base64")}`;
            break;
          }
          case "UUID":
            if (typeof rec.toString === "function" && rec.toString !== Object.prototype.toString)
              return `uuid:${String(rec.toString())}`;
            break;
          case "Timestamp":
          case "LongTimestamp": {
            const t = (rec.t ?? rec.high) as unknown;
            const i = (rec.i ?? rec.low) as unknown;
            return `timestamp:${String(t)}:${String(i)}`;
          }
          case "Code":
            return `code:${String(rec.code ?? "")}:${String(rec.scope ? JSON.stringify(canonicalizeBaselineValue(rec.scope)) : "")}`;
          case "DBRef":
            return `dbref:${String(rec.namespace ?? rec.collection ?? "")}:${JSON.stringify(canonicalizeBaselineValue(rec.oid))}`;
          case "BSONRegExp":
            return `regexp:${String(rec.pattern ?? "")}:${String(rec.options ?? "")}`;
          case "MinKey":
            return "minkey:";
          case "MaxKey":
            return "maxkey:";
          default:
            break;
        }
      } catch {
        return `${bsontype.toLowerCase()}:unreadable`;
      }
    }
    // EJSON forms (a doc that round-tripped through extended JSON).
    const keys = Object.keys(rec);
    if (keys.length === 1) {
      const only = keys[0];
      const inner = rec[only];
      if (only === "$oid" && typeof inner === "string") return `oid:${inner}`;
      if (only === "$date") {
        const iso =
          typeof inner === "string"
            ? inner
            : typeof (inner as { $numberLong?: unknown }).$numberLong === "string"
              ? new Date(Number((inner as { $numberLong: string }).$numberLong)).toISOString()
              : new Date(Number(inner)).toISOString();
        return `date:${iso}`;
      }
      if (only === "$numberLong" && typeof inner === "string")
        return canonicalNumberToken(inner, "long");
      if (only === "$numberDecimal" && typeof inner === "string")
        return canonicalNumberToken(inner, "decimal");
      if (only === "$numberInt" && typeof inner === "string")
        return canonicalNumberToken(inner, "int");
      if (only === "$numberDouble" && typeof inner === "string")
        return canonicalNumberToken(inner, "double");
      if (only === "$binary" && typeof inner === "object" && inner !== null) {
        const b64 = (inner as { base64?: unknown }).base64;
        const subType = (inner as { subType?: unknown }).subType;
        if (typeof b64 === "string") return `buffer:${canonicalBinarySubType(subType)}:${b64}`;
      }
      if (only === "$uuid" && typeof inner === "string") return `uuid:${inner}`;
      if (only === "$timestamp" && typeof inner === "object" && inner !== null) {
        const t = (inner as { t?: unknown }).t;
        const i = (inner as { i?: unknown }).i;
        return `timestamp:${String(t)}:${String(i)}`;
      }
      if (only === "$regularExpression" && typeof inner === "object" && inner !== null) {
        const rx = inner as { pattern?: unknown; options?: unknown };
        return `regexp:${String(rx.pattern ?? "")}:${String(rx.options ?? "")}`;
      }
      if (only === "$undefined" && inner === true) return "undefined:undefined";
      if (only === "$minKey" && inner === 1) return "minkey:";
      if (only === "$maxKey" && inner === 1) return "maxkey:";
    }
    const out: Record<string, unknown> = {};
    for (const key of keys.sort()) out[key] = canonicalizeBaselineValue(rec[key]);
    return out;
  }
  return value;
}

/** Deterministic JSON: same logical doc always serializes identically. */
export function stableStringifyBaseline(value: unknown): string {
  return JSON.stringify(canonicalizeBaselineValue(value));
}

/** Content hash of one snapshot document. */
export function hashBaselineDocument(doc: unknown): string {
  return sha256Hex(stableStringifyBaseline(doc));
}

/** One covered collection: doc count plus the hash of its sorted doc hashes. */
export interface BaselineCollectionManifest {
  name: string;
  count: number;
  hash: string;
}

/** Full snapshot seal: per-collection entries plus one versioned digest. */
export interface BaselineManifest {
  version: typeof BASELINE_SEAL_VERSION;
  baselineId: string;
  collections: BaselineCollectionManifest[];
  totalDocs: number;
  digest: string;
}

/** Bounds for one streaming build; production callers omit both (module caps). */
export interface BaselineManifestLimits {
  maxDocs?: number;
  maxDocsPerCollection?: number;
}

/**
 * Incremental v2 manifest builder. Feed every doc exactly once, in ANY
 * order (cursor order, interleaved collections, shuffled replays all give
 * the identical digest); call finish() once iteration completes. Memory is
 * one 32-byte sum plus a counter per touched collection: the builder never
 * retains docs or doc hashes.
 *
 * Commutative digest, explicitly: each doc's sha256 content hash adds into
 * its collection sum as a 256-bit integer (mod 2^256). Addition commutes,
 * so order cannot count and no deterministic DB sort (with its BSON
 * mixed-type ordering pitfalls) is needed. Collision properties:
 * - Count binding: the doc count is hashed into the collection hash AND
 *   compared separately by diffBaselineManifests, so padding/truncation
 *   always trips both.
 * - Duplicates: identical doc hashes ADD (no XOR cancellation), so the
 *   multiset {A, A} differs from {A} in sum and in count. Every doc ever
 *   read still moves the digest.
 * - Second preimage: forging a different multiset with the same sum and
 *   count is a subset-sum search (~2^128 meet-in-the-middle over large
 *   multisets); accidental collision sits at ~2^-256 per collection.
 *   This is an integrity tripwire against mutation, not a commitment
 *   scheme against an adversary choosing the snapshot content.
 *
 * Ceilings bind DURING iteration: add() throws on the exact doc that
 * pushes a collection past maxDocsPerCollection or the snapshot past
 * maxDocs, before pathological growth can exhaust the observer. A builder
 * that threw is finished: finish() after a throw refuses.
 */
export interface StreamingManifestBuilder {
  add(collection: string, doc: unknown): void;
  finish(): BaselineManifest;
  totalDocs(): number;
  countFor(collection: string): number;
}

function addIntoSum(sum: Uint8Array, hash: Uint8Array): void {
  let carry = 0;
  for (let i = sum.length - 1; i >= 0; i--) {
    const step = sum[i] + (hash[i] ?? 0) + carry;
    sum[i] = step & 0xff;
    carry = step >>> 8;
  }
}

function hexOfSum(sum: Uint8Array): string {
  return Buffer.from(sum.buffer, sum.byteOffset, sum.byteLength).toString("hex");
}

function hashOfBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

export function createStreamingManifestBuilder(
  baselineId: string,
  limits?: BaselineManifestLimits
): StreamingManifestBuilder {
  const maxDocs = limits?.maxDocs ?? BASELINE_MANIFEST_MAX_DOCS;
  const maxPerCollection =
    limits?.maxDocsPerCollection ?? BASELINE_MANIFEST_MAX_DOCS_PER_COLLECTION;
  const sums = new Map<string, { sum: Uint8Array; count: number }>();
  let total = 0;
  let failed = false;
  return {
    add(collection: string, doc: unknown): void {
      if (failed) {
        throw new Error(
          `baseline "${baselineId}" manifest builder already failed: refusing to continue a tripped observation`
        );
      }
      const entry = sums.get(collection) ?? { sum: new Uint8Array(32), count: 0 };
      const nextCount = entry.count + 1;
      if (nextCount > maxPerCollection) {
        failed = true;
        throw new Error(
          `baseline "${baselineId}" collection "${collection}" holds more than ${maxPerCollection} docs ` +
            `(${nextCount} and counting): refusing to seal an unbounded collection mid-iteration`
        );
      }
      if (total + 1 > maxDocs) {
        failed = true;
        throw new Error(
          `baseline "${baselineId}" holds more than ${maxDocs} docs (${total + 1} and counting): ` +
            `refusing to seal an unbounded snapshot mid-iteration`
        );
      }
      addIntoSum(entry.sum, hashOfBytes(Buffer.from(hashBaselineDocument(doc), "hex")));
      entry.count = nextCount;
      sums.set(collection, entry);
      total += 1;
    },
    finish(): BaselineManifest {
      if (failed) {
        throw new Error(
          `baseline "${baselineId}" manifest observation tripped a ceiling: refusing to finish a failed build`
        );
      }
      const collections: BaselineCollectionManifest[] = [...sums.keys()].sort().map((name) => {
        const entry = sums.get(name) as { sum: Uint8Array; count: number };
        return {
          name,
          count: entry.count,
          hash: sha256Hex(
            [
              "baseline-manifest/v2/collection",
              name,
              `count:${entry.count}`,
              `sum:${hexOfSum(entry.sum)}`,
            ].join("\n")
          ),
        };
      });
      const digest = sha256Hex(
        [
          "baseline-manifest/v2",
          baselineId,
          ...collections.map((c) => `${c.name}:${c.count}:${c.hash}`),
        ].join("\n")
      );
      return { version: BASELINE_SEAL_VERSION, baselineId, collections, totalDocs: total, digest };
    },
    totalDocs(): number {
      return total;
    },
    countFor(collection: string): number {
      return sums.get(collection)?.count ?? 0;
    },
  };
}

/**
 * Builds the manifest from already-read docs. Thin small-input wrapper over
 * the streaming builder (same digest as a streamed observation of the same
 * docs); production observers with real cursors must use
 * observeBaselineSnapshot instead so nothing buffers the snapshot.
 */
export function buildBaselineManifest(
  baselineId: string,
  docsByCollection: Record<string, unknown[]>
): BaselineManifest {
  const builder = createStreamingManifestBuilder(baselineId);
  for (const name of Object.keys(docsByCollection).sort()) {
    for (const doc of docsByCollection[name] ?? []) builder.add(name, doc);
  }
  return builder.finish();
}

/**
 * Cursor-driven observation shared by every production scan (capture stamp,
 * pre-copy source check, post-copy source re-check, post-copy dest check).
 * collectionNames arrives pre-sorted by the caller; openCursor streams one
 * collection's docs in whatever order the cursor yields (order never
 * counts). A cursor that throws aborts the observation with the cursor's
 * own error: no partial manifest is ever returned. Pure over injected
 * cursors (no Mongo import); scripts pass real batch cursors.
 */
export async function observeBaselineSnapshot(
  baselineId: string,
  collectionNames: string[],
  openCursor: (name: string) => AsyncIterable<unknown>,
  limits?: BaselineManifestLimits
): Promise<BaselineManifest> {
  const builder = createStreamingManifestBuilder(baselineId, limits);
  for (const name of collectionNames) {
    for await (const doc of openCursor(name)) builder.add(name, doc);
  }
  return builder.finish();
}

/**
 * Exact drift between a sealed manifest and a fresh observation, one line per
 * difference (collection added/removed/count/hash, turn handled by callers).
 * Empty means identical.
 */
export function diffBaselineManifests(
  sealed: BaselineManifest,
  observed: BaselineManifest
): string[] {
  const drift: string[] = [];
  if (sealed.version !== observed.version) {
    drift.push(
      `seal version ${String(sealed.version)}->${String(observed.version)} (re-stamp with the current stamper)`
    );
  }
  if (sealed.baselineId !== observed.baselineId) {
    drift.push(
      `baseline id ${JSON.stringify(sealed.baselineId)}->${JSON.stringify(observed.baselineId)}`
    );
  }
  const want = new Map(sealed.collections.map((c) => [c.name, c]));
  const got = new Map(observed.collections.map((c) => [c.name, c]));
  for (const [name, s] of want) {
    const o = got.get(name);
    if (!o) {
      drift.push(`collection "${name}" removed (sealed with ${s.count} docs)`);
      continue;
    }
    if (s.count !== o.count) {
      drift.push(`collection "${name}" count ${s.count}->${o.count}`);
    }
    if (s.hash !== o.hash) {
      drift.push(`collection "${name}" content hash changed`);
    }
  }
  for (const [name, o] of got) {
    if (!want.has(name)) {
      drift.push(`collection "${name}" added with ${o.count} docs`);
    }
  }
  if (sealed.digest !== observed.digest) {
    drift.push(`overall digest ${sealed.digest.slice(0, 12)}..->${observed.digest.slice(0, 12)}..`);
  }
  return drift;
}

/** Throws fail-closed with the exact drift when manifests differ. */
export function assertBaselineManifestsEqual(
  sealed: BaselineManifest,
  observed: BaselineManifest,
  context: string
): void {
  const drift = diffBaselineManifests(sealed, observed);
  if (drift.length > 0) {
    throw new Error(`${context}: refusing (${drift.join("; ")})`);
  }
}

/** Durable capture lifecycle of one baseline snapshot marker. */
export type BaselineCaptureStatus = "capturing" | "sealed";

/** Loose shape of a stored simBaselines marker doc (real Mongo doc or fake). */
export interface BaselineMarkerDoc {
  _id?: unknown;
  baselineId?: unknown;
  sealVersion?: unknown;
  status?: unknown;
  sourceTurn?: unknown;
  manifest?: unknown;
  captureId?: unknown;
  /** Legacy weak-seal fields (pre-manifest markers). */
  docCount?: unknown;
  stateHash?: unknown;
}

export function baselineMarkerIdentity(marker: BaselineMarkerDoc): unknown {
  return marker._id ?? marker.baselineId;
}

/** True only for a complete v1 sealed marker (clone + manifest succeeded). */
export function isSealedBaselineMarker(marker: BaselineMarkerDoc): boolean {
  if (marker.sealVersion !== BASELINE_SEAL_VERSION) return false;
  if (marker.status !== "sealed") return false;
  const manifest = marker.manifest as Partial<BaselineManifest> | undefined;
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    manifest.version === BASELINE_SEAL_VERSION &&
    typeof manifest.digest === "string" &&
    Array.isArray(manifest.collections)
  );
}

/** True for a legacy weak marker (turn/count/gameState-hash only, no manifest). */
export function isLegacyBaselineMarker(marker: BaselineMarkerDoc): boolean {
  return !isSealedBaselineMarker(marker) && marker.status !== "capturing";
}

/**
 * Reads the sealed manifest out of a marker, failing closed on anything
 * else: missing (never captured), capturing (clone/seal incomplete or
 * crashed), legacy weak (pre-manifest seal), or version drift. Every message
 * names the recovery (capture, resume, or re-stamp).
 */
export function readSealedBaselineManifest(
  marker: BaselineMarkerDoc | null | undefined,
  baselineId: string
): BaselineManifest {
  if (!marker) {
    throw new Error(
      `baseline "${baselineId}" has no simBaselines marker: capture it with cloneWorld.ts + stampBaseline.ts before claiming arms`
    );
  }
  if (baselineMarkerIdentity(marker) !== baselineId) {
    throw new Error(
      `baseline marker identity mismatch (marker ${JSON.stringify(baselineMarkerIdentity(marker))} != ${JSON.stringify(baselineId)}): refusing to claim from an overwritten snapshot`
    );
  }
  if (
    marker.status === "capturing" ||
    (!isSealedBaselineMarker(marker) && typeof marker.captureId === "string")
  ) {
    throw new Error(
      `baseline "${baselineId}" capture is incomplete (reservation held by ${formatCaptureHolder(marker.captureId)}): ` +
        `the clone or seal crashed or is still running; resume the capture with the same --capture-id, then seal with stampBaseline.ts before claiming arms`
    );
  }
  // A sealed v1 marker is NOT a legacy weak seal (it carries a manifest),
  // but its per-collection digests are hash-sorted v1 values that never
  // compare equal to v2 streaming digests. Upgrading is the only recovery:
  // re-stamp, never claim.
  if (marker.sealVersion === 1 && marker.status === "sealed") {
    throw new Error(
      `baseline "${baselineId}" carries a sealed v1 manifest (pre-streaming digest): ` +
        `re-stamp it with the current stampBaseline.ts before claiming arms`
    );
  }
  if (!isSealedBaselineMarker(marker)) {
    throw new Error(
      `baseline "${baselineId}" carries a legacy weak seal (turn/count/gameState-hash only, no full-snapshot manifest): ` +
        `re-stamp it with the current stampBaseline.ts before claiming arms`
    );
  }
  const manifest = marker.manifest as BaselineManifest;
  if (manifest.baselineId !== baselineId) {
    throw new Error(
      `baseline marker manifest identity mismatch (manifest ${JSON.stringify(manifest.baselineId)} != ${JSON.stringify(baselineId)}): refusing to claim from an overwritten snapshot`
    );
  }
  return manifest;
}

/**
 * Durable exclusive first-capture gate (cloneWorld.ts, before any --drop).
 * Mongo _id uniqueness makes the reservation insert the serialization point;
 * this pure resolver classifies the loser:
 * - no marker: first capture, proceed;
 * - sealed marker: same-id recapture would mutate a referenced snapshot, refuse;
 * - capturing marker with the SAME captureId: crash retry, resume;
 * - capturing marker with another id (or none): concurrent capture, refuse.
 */
export function resolveBaselineCapture(
  existing: BaselineMarkerDoc | null | undefined,
  captureId: string
): "proceed" | "resume" {
  if (!existing) return "proceed";
  if (isSealedBaselineMarker(existing)) {
    throw new Error(
      `refusing to capture baseline "${String(baselineMarkerIdentity(existing))}": it is already sealed ` +
        `(same-id recapture would mutate an already referenced snapshot; capture under a new baselineId instead)`
    );
  }
  // A sealed v1 marker is a real seal (not a legacy weak one), so a
  // same-id recapture refuses as already-sealed, exactly like v2: the
  // snapshot may already be referenced by arms. Upgrading happens through
  // stampBaseline.ts, never through a fresh capture.
  if (existing.sealVersion === 1 && existing.status === "sealed") {
    throw new Error(
      `refusing to capture baseline "${String(baselineMarkerIdentity(existing))}": it is already sealed ` +
        `(v1 seal; same-id recapture would mutate an already referenced snapshot; ` +
        `re-stamp it with the current stampBaseline.ts to upgrade, or capture under a new baselineId instead)`
    );
  }
  // A non-sealed, non-capturing marker is a legacy weak seal: it has no
  // captureId to resume with, so the generic in-progress guidance would be
  // impossible to follow. Refuse just the same (the snapshot may already be
  // referenced), but point at the real recoveries: upgrade or a new id.
  if (existing.status !== "capturing") {
    throw new Error(
      `refusing to capture baseline "${String(baselineMarkerIdentity(existing))}": it carries a legacy weak seal ` +
        `(turn/count/gameState-hash only, no full-snapshot manifest; re-stamp it with the current stampBaseline.ts to upgrade, ` +
        `or capture under a new baselineId instead)`
    );
  }
  const holder = existing.captureId;
  if (typeof holder === "string" && holder === captureId) return "resume";
  throw new Error(
    `refusing to capture baseline "${String(baselineMarkerIdentity(existing))}": a capture is already ` +
      `in progress (reservation held by ${formatCaptureHolder(holder)}); resume it with the same --capture-id or clear the stale reservation first`
  );
}

/** Reservation doc a capturer inserts before any destructive clone/drop. */
export function buildCaptureReservationDoc(
  baselineId: string,
  captureId: string,
  startedAt: Date
): Record<string, unknown> {
  return {
    _id: baselineId,
    baselineId,
    status: "capturing",
    captureId,
    startedAt,
    checkedAt: startedAt,
  };
}

/** Sealed marker doc the stamper writes after clone + manifest succeed. */
export function buildSealedMarkerDoc(
  baselineId: string,
  sourceTurn: number,
  manifest: BaselineManifest,
  stampedAt: Date,
  captureId?: string
): Record<string, unknown> {
  return {
    _id: baselineId,
    baselineId,
    sealVersion: BASELINE_SEAL_VERSION,
    status: "sealed",
    sourceTurn,
    manifest,
    totalDocs: manifest.totalDocs,
    digest: manifest.digest,
    ...(captureId !== undefined ? { captureId } : {}),
    stampedAt,
    checkedAt: stampedAt,
  };
}

/** Fresh observation of a snapshot db: turn plus its full manifest. */
export interface BaselineObservation {
  baselineId: string;
  sourceTurn: number;
  manifest: BaselineManifest;
}

/**
 * Stamp gate: same sealed observation re-stamps idempotently; any drift in
 * turn or manifest refuses (something ran against the snapshot). A
 * capturing reservation (no manifest yet), a legacy weak marker, and a
 * sealed v1 marker all accept the first v2 seal: the former completes the
 * capture, the latter two upgrade the seal (v1 digests never compare equal
 * to v2, so there is no drift to check against: the fresh manifest becomes
 * ground truth). Pure so the refusal is unit-testable without Mongo.
 */
export function assertBaselineStampCompatible(
  existing: BaselineMarkerDoc | null,
  observed: BaselineObservation
): void {
  if (!existing) return;
  if (baselineMarkerIdentity(existing) !== observed.baselineId) {
    throw new Error(
      `baseline marker identity mismatch (marker ${JSON.stringify(baselineMarkerIdentity(existing))} != ${JSON.stringify(observed.baselineId)}): refusing to stamp an overwritten snapshot`
    );
  }
  // Completing a capture reservation or upgrading a legacy weak marker: the
  // first v1 seal always lands (there is no trustworthy prior seal to drift
  // from; the new manifest becomes ground truth).
  if (!isSealedBaselineMarker(existing)) return;
  const sealedTurn = existing.sourceTurn;
  if (sealedTurn !== observed.sourceTurn) {
    throw new Error(
      `baseline "${observed.baselineId}" changed since capture (turn ${String(sealedTurn)}->${observed.sourceTurn}): refusing to re-stamp a mutated snapshot`
    );
  }
  assertBaselineManifestsEqual(
    existing.manifest as BaselineManifest,
    observed.manifest,
    `baseline "${observed.baselineId}" changed since capture`
  );
}

/**
 * Fail-closed claim gate (worker.ts): the baseline db must carry the sealed
 * marker AND still match it right now (turn + full manifest re-observed
 * immediately before the sandbox-to-sandbox copy). Returns the verified
 * sealed manifest for the post-copy checks. Legacy, capturing, and missing
 * markers fail inside readSealedBaselineManifest with their recovery.
 */
export function assertBaselineMarkerForClaim(
  marker: BaselineMarkerDoc | null | undefined,
  observed: BaselineObservation
): BaselineManifest {
  const sealed = readSealedBaselineManifest(marker, observed.baselineId);
  if ((marker as BaselineMarkerDoc).sourceTurn !== observed.sourceTurn) {
    throw new Error(
      `baseline "${observed.baselineId}" changed since capture (turn ${String((marker as BaselineMarkerDoc).sourceTurn)}->${observed.sourceTurn}): refusing to claim a mutated snapshot`
    );
  }
  assertBaselineManifestsEqual(
    sealed,
    observed.manifest,
    `baseline "${observed.baselineId}" changed since capture`
  );
  return sealed;
}

/**
 * Marker-travel check after the sandbox-to-sandbox copy: the arm db must
 * carry the same sealed marker the source check just verified (the marker
 * collection copies with the snapshot). Seal fields only (timestamps never
 * count). A divergence means the copy raced or copied the wrong source.
 */
export function assertCopiedMarkerMatches(
  source: BaselineMarkerDoc | null | undefined,
  dest: BaselineMarkerDoc | null | undefined,
  baselineId: string
): void {
  if (!dest) {
    throw new Error(
      `baseline "${baselineId}" copy landed without its simBaselines marker: refusing to run an unverified start`
    );
  }
  const bad =
    baselineMarkerIdentity(dest) !== baselineMarkerIdentity(source ?? {}) ||
    dest.sealVersion !== source?.sealVersion ||
    dest.status !== source?.status ||
    dest.sourceTurn !== source?.sourceTurn ||
    (dest.manifest as BaselineManifest | undefined)?.digest !==
      (source?.manifest as BaselineManifest | undefined)?.digest;
  if (bad) {
    throw new Error(
      `baseline "${baselineId}" copied marker diverges from the verified source seal: refusing to run a forked start`
    );
  }
}

/**
 * Full post-copy gate (worker.ts): marker travel (dest marker == source
 * marker) plus dest-state equality (re-observed dest manifest == dest
 * marker). Marker equality alone cannot catch a source mutation between the
 * pre-copy seal check and the copy (mutated state copies with the unchanged
 * marker), so the caller ALSO re-observes the source after the copy and
 * compares it to the sealed manifest (assertSourceManifestStableAcrossCopy):
 * transitivity then closes the race as far as a copy allows (source check
 * proved marker == pre-copy state; post check proves post-copy source ==
 * marker; dest check proves dest marker == dest state).
 */
export function assertCopiedBaselineMatches(
  source: BaselineMarkerDoc | null | undefined,
  dest: BaselineMarkerDoc | null | undefined,
  destObserved: BaselineObservation,
  baselineId: string
): void {
  assertCopiedMarkerMatches(source, dest, baselineId);
  assertBaselineMarkerForClaim(dest, destObserved);
}

/**
 * Claim-to-copy race narrowing: after the copy, the SOURCE is re-observed
 * and must still equal the sealed manifest the pre-copy check verified. A
 * source mutation during the copy fails closed even when the dest faithfully
 * copied the mutated state (which marker travel alone would accept).
 */
export function assertSourceManifestStableAcrossCopy(
  sealed: BaselineManifest,
  postCopyObserved: BaselineObservation,
  baselineId: string
): void {
  assertBaselineManifestsEqual(
    sealed,
    postCopyObserved.manifest,
    `baseline "${baselineId}" source changed during the copy`
  );
}

/** Expected-baseline-digest fence flag: exactly one 64-hex sha256 digest. */
export function assertBaselineDigestFlag(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      `--expected-baseline-digest must be a 64-hex sha256 digest (got ${JSON.stringify(value)})`
    );
  }
  return value;
}

/**
 * Final pre-spawn fence (runWorld.ts, baselined arms only): after the
 * worker's post-copy dest observation, and immediately before the first
 * turn write, the child re-reads the ONE simBaselines marker doc in its arm
 * db and compares it to the digest the worker verified. A write to the arm
 * db between the worker's dest observation and this spawn (stale re-copy,
 * supervisor poke, second arm sharing the db) fails closed here instead of
 * running turns on an unverified start. Single-doc read, never a scan, and
 * unpaired runs never pay it (the flag is refused there).
 *
 * Residual race, explicit: a writer landing between THIS read and the
 * first turn write still slips through; that window is one document read
 * inside child startup, down from the whole copy-plus-spawn gap. Closing
 * it fully needs a Mongo transaction or a fencing token on every write,
 * which the turn engine does not have.
 */
export function assertArmFenceMarker(
  marker: BaselineMarkerDoc | null | undefined,
  baselineId: string,
  expectedDigest: string
): void {
  if (!marker) {
    throw new Error(
      `baseline "${baselineId}" arm db carries no simBaselines marker at spawn: ` +
        `the copy did not land or something dropped it; refusing to run`
    );
  }
  if (baselineMarkerIdentity(marker) !== baselineId) {
    throw new Error(
      `baseline arm marker identity mismatch at spawn (marker ${JSON.stringify(baselineMarkerIdentity(marker))} != ${JSON.stringify(baselineId)}): refusing to run`
    );
  }
  if (!isSealedBaselineMarker(marker)) {
    throw new Error(
      `baseline "${baselineId}" arm marker is not a sealed v${BASELINE_SEAL_VERSION} seal at spawn: refusing to run`
    );
  }
  const digest = (marker.manifest as BaselineManifest | undefined)?.digest;
  if (digest !== expectedDigest) {
    throw new Error(
      `baseline "${baselineId}" arm db changed after the verified copy ` +
        `(seal ${String(digest).slice(0, 12)}.. != verified ${expectedDigest.slice(0, 12)}..): refusing to run`
    );
  }
}
