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
 * - Stability: objects hash with sorted keys, documents hash sorted within
 *   each collection, collections sort by name, and BSON extras canonicalize
 *   (Date/ObjectId/Binary/Long/Decimal/Timestamp/etc. by value, including
 *   EJSON forms), so key order, doc order, collection order, and driver
 *   representation never count as drift.
 * - Diagnosis: per-collection {name, count, hash} plus one overall versioned
 *   digest. Claim and post-copy checks report exactly which collection
 *   drifted (added/removed/count/hash) instead of a bare mismatch.
 *
 * Cost (explicit and bounded): building a manifest is O(total cloned docs)
 * with one batch cursor per covered collection. It runs ONLY on the
 * one-time baseline capture path (stampBaseline.ts: one scan) and the
 * baselined arm-claim path (worker.ts: pre-copy source scan, post-copy
 * source re-scan, post-copy dest scan). Ordinary unpaired turns and
 * fresh-bootstrap pairs never build a manifest. A hard doc ceiling
 * (BASELINE_MANIFEST_MAX_DOCS) fails closed instead of scanning unbounded.
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

/** Seal representation version. Claim rejects any other version fail-closed. */
export const BASELINE_SEAL_VERSION = 1;

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
 */
export const BASELINE_MANIFEST_MAX_DOCS = 5_000_000;

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
  if (Number.isSafeInteger(n) && String(n) === raw.replace(/^\+/, "").replace(/\.0+$/, "")) {
    return `number:${n}`;
  }
  if (Number.isFinite(n) && String(n) === raw) return `number:${raw}`;
  return `${kind}:${raw}`;
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
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    // Node Buffer / Uint8Array: raw bytes by base64.
    if (Buffer.isBuffer(value)) return `buffer:${(value as Buffer).toString("base64")}`;
    if (value instanceof Uint8Array) return `buffer:${base64OfBytes(value)}`;
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
          case "Binary":
            if (rec.buffer instanceof Uint8Array) return `buffer:${base64OfBytes(rec.buffer)}`;
            if (Buffer.isBuffer(rec.buffer))
              return `buffer:${(rec.buffer as Buffer).toString("base64")}`;
            break;
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
        if (typeof b64 === "string") return `buffer:${b64}`;
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

/**
 * Builds the manifest from already-read docs (scripts own the cursors).
 * Collection entries sort by name; doc hashes sort within a collection, so
 * read order never counts. Throws past BASELINE_MANIFEST_MAX_DOCS.
 */
export function buildBaselineManifest(
  baselineId: string,
  docsByCollection: Record<string, unknown[]>
): BaselineManifest {
  const collections: BaselineCollectionManifest[] = Object.keys(docsByCollection)
    .sort()
    .map((name) => {
      const docs = docsByCollection[name] ?? [];
      const hashes = docs.map(hashBaselineDocument).sort();
      return { name, count: docs.length, hash: sha256Hex(hashes.join("\n")) };
    });
  const totalDocs = collections.reduce((sum, c) => sum + c.count, 0);
  if (totalDocs > BASELINE_MANIFEST_MAX_DOCS) {
    throw new Error(
      `baseline "${baselineId}" holds ${totalDocs} docs past the audited seal bound ` +
        `(${BASELINE_MANIFEST_MAX_DOCS}): refusing to seal an unbounded snapshot`
    );
  }
  const digest = sha256Hex(
    [
      "baseline-manifest/v1",
      baselineId,
      ...collections.map((c) => `${c.name}:${c.count}:${c.hash}`),
    ].join("\n")
  );
  return { version: BASELINE_SEAL_VERSION, baselineId, collections, totalDocs, digest };
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
      `baseline "${baselineId}" capture is incomplete (reservation held by ${JSON.stringify(marker.captureId)}): ` +
        `the clone or seal crashed or is still running; resume the capture with the same --capture-id, then seal with stampBaseline.ts before claiming arms`
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
  const holder = existing.captureId;
  if (typeof holder === "string" && holder === captureId) return "resume";
  throw new Error(
    `refusing to capture baseline "${String(baselineMarkerIdentity(existing))}": a capture is already ` +
      `in progress (reservation held by ${JSON.stringify(holder)}); resume it with the same --capture-id or clear the stale reservation first`
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
 * capturing reservation (no manifest yet) and a legacy weak marker both
 * accept the first v1 seal: the former completes the capture, the latter
 * upgrades the seal. Pure so the refusal is unit-testable without Mongo.
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
