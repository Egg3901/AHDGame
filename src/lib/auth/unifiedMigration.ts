import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
  createCentralFenceAttestationReader,
  createCohortEnrollment,
  createCredentialImportDispatcher,
  createCredentialImportReceiptReader,
  createEnrollmentReservationStore,
  createIdempotencyKey,
  createSourceOwnershipProofReader,
} from "@lakeside/auth-enrollment";
import { createProvisionAccessTokenProvider } from "@lakeside/account-registry";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { createSourceFenceWriter } from "@/lib/auth/sourceFenceWriter";
import { createSourceOwnershipProofStore } from "@/lib/auth/sourceOwnershipProof";

const SOURCE_ISSUER = "urn:lakeside:legacy:ahd:production";
const AUTHORITY = "ahd-unified-cohort";
const PROVENANCE = "ahd:password-login:unified-cohort";
const HEX24 = /^[0-9a-f]{24}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type CohortTarget = Readonly<{ canonicalAccountId: string; userId: string }>;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing unified migration configuration: ${name}`);
  return value;
}

function cohort(): ReadonlyMap<string, CohortTarget> {
  const parsed = JSON.parse(required("AHD_UNIFIED_COHORT_TARGETS")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid unified cohort");
  const entries = Object.entries(parsed as Record<string, CohortTarget>);
  if (entries.length !== 2) throw new Error("Invalid unified cohort");
  for (const [sourceId, target] of entries) {
    if (
      !HEX24.test(sourceId) ||
      !UUID.test(target?.canonicalAccountId) ||
      !UUID.test(target?.userId)
    ) {
      throw new Error("Invalid unified cohort");
    }
  }
  return new Map(entries);
}

function databasePool(user: string, passwordName: string, database: string): Pool {
  return new Pool({
    host: required("LAKESIDE_IDENTITY_DB_HOST"),
    port: Number(required("LAKESIDE_IDENTITY_DB_PORT")),
    database,
    user,
    password: required(passwordName),
    ssl: {
      ca: Buffer.from(required("LAKESIDE_IDENTITY_DB_CA_B64"), "base64").toString("utf8"),
      rejectUnauthorized: true,
    },
    max: 3,
    connectionTimeoutMillis: 3000,
    query_timeout: 10000,
  });
}

function tokenProvider(prefix: string) {
  return createProvisionAccessTokenProvider({
    tokenEndpoint: `${required("UNIFIED_OIDC_ISSUER")}/protocol/openid-connect/token`,
    clientId: required(`${prefix}_CLIENT_ID`),
    clientSecret: required(`${prefix}_CLIENT_SECRET`),
    timeoutMs: 5000,
  });
}

async function postAuthority(
  path: string,
  prefix: string,
  body: object
): Promise<Record<string, unknown>> {
  const token = await tokenProvider(prefix).obtainAccessToken();
  const response = await fetch(
    `${required("UNIFIED_OIDC_ISSUER")}/lakeside-provision-transport/${path}`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    }
  );
  if (response.status !== 200) throw new Error(`Unified issuer ${path} rejected the migration`);
  return (await response.json()) as Record<string, unknown>;
}

export function isUnifiedMigrationCohort(sourceAccountId: string): boolean {
  try {
    return cohort().has(sourceAccountId);
  } catch {
    return false;
  }
}

export async function migratePasswordLoginToUnified(sourceAccountId: string, password: string) {
  const targets = cohort();
  const target = targets.get(sourceAccountId);
  if (!target) throw new Error("Account is not in the unified migration cohort");

  const coordinator = databasePool(
    "lakeside_enrollment_runtime",
    "LAKESIDE_ENROLLMENT_RUNTIME_PASSWORD",
    "lakeside_coordinator"
  );
  const fenceReaderPool = databasePool(
    "lakeside_fence_attestation_reader",
    "LAKESIDE_FENCE_READER_PASSWORD",
    "lakeside_coordinator"
  );
  const receiptReaderPool = databasePool(
    "lakeside_provision_receipt_reader",
    "LAKESIDE_PROVISION_READER_PASSWORD",
    "railway"
  );
  try {
    const db = await getDb();
    const mongo = await getMongoClient();
    const targetIssuer = required("UNIFIED_OIDC_ISSUER");
    const realmId = required("UNIFIED_OIDC_REALM_ID");
    const sourceIds = [...targets.keys()];
    const proofStore = createSourceOwnershipProofStore({
      sourceIssuer: SOURCE_ISSUER,
      client: mongo,
      databaseName: db.databaseName,
      privilegedCohortSourceAccountIds: sourceIds,
    });
    const reservations = createEnrollmentReservationStore(coordinator, {
      allowedSourceIssuers: [SOURCE_ISSUER],
    });
    const reservation = await reservations.reserve({
      sourceIdentity: { issuer: SOURCE_ISSUER, subject: sourceAccountId },
      provenance: PROVENANCE,
    });
    if (reservation.canonicalAccountId !== target.canonicalAccountId)
      throw new Error("Canonical cohort mapping changed");
    const proof = await proofStore.issuePasswordProof({
      sourceAccountId,
      password,
      reserveEnrollment: async () => reservation,
    });
    const sourceProofReader = createSourceOwnershipProofReader({
      sourceIssuer: SOURCE_ISSUER,
      loadSourceProof: ({ proofId }: { proofId: string }) => proofStore.loadProof({ proofId }),
    });
    const loadCentralFenceAttestation = createCentralFenceAttestationReader(fenceReaderPool, {
      sourceIssuer: SOURCE_ISSUER,
      targetIssuer,
      targetRealmId: realmId,
    });
    const loadCommittedImportReceipt = createCredentialImportReceiptReader(receiptReaderPool, {
      issuer: targetIssuer,
      realmId,
    });
    const enrollment = createCohortEnrollment(coordinator, {
      allowedLegacyIdentities: sourceIds.map((subject) => ({ issuer: SOURCE_ISSUER, subject })),
      allowedImportIssuers: [targetIssuer],
      sourceProofReader,
      loadCommittedImportReceipt,
      loadActivationReceipt: async (binding: Record<string, unknown>) =>
        postAuthority("activation-receipt", "LAKESIDE_ACTIVATION_RECEIPT_READER", {
          accountId: binding.accountId,
          operationId: binding.operationId,
          userId: binding.userId,
          importReceiptId: binding.importReceiptId,
        }),
      leaseSeconds: 60,
    });
    await enrollment.admitEnrollment({
      reservation,
      proofId: proof.proofId,
      sourceAccountId,
      idempotencyKey: createIdempotencyKey(),
      provenance: PROVENANCE,
    });
    const claimed = await enrollment.claimEnrollment({
      operationId: reservation.enrollmentOperationId,
      idempotencyKey: createIdempotencyKey(),
      authorityId: AUTHORITY,
      provenance: PROVENANCE,
    });
    const lease = {
      operationId: reservation.enrollmentOperationId,
      authorityId: claimed.lease.authorityId,
      leaseToken: claimed.lease.leaseToken,
      leaseGeneration: claimed.lease.leaseGeneration,
    };
    await enrollment.fenceEnrollment({
      ...lease,
      idempotencyKey: createIdempotencyKey(),
      provenance: PROVENANCE,
    });
    const fenceWriter = createSourceFenceWriter({
      client: mongo,
      db,
      sourceIssuer: SOURCE_ISSUER,
      clockSkewBoundMs: 5000,
      clockSkewEvidence: "Production databases use provider synchronized clocks",
      loadSourceProof: ({ proofId }: { proofId: string }) => proofStore.loadProof({ proofId }),
      loadCentralFenceAttestation,
      privilegedCohortSourceAccountIds: sourceIds,
    });
    const fenced = await fenceWriter.applySourceFence({
      proofId: proof.proofId,
      provenance: PROVENANCE,
    });
    if (!fenced.receiptId || !["COMMITTED", "REPLAY_NO_MUTATION"].includes(fenced.status))
      throw new Error("Source fence did not commit");
    const material = await fenceWriter.loadCredentialImportMaterial({
      proofId: proof.proofId,
      receiptId: fenced.receiptId,
    });
    if (!material) throw new Error("Committed credential material is unavailable");
    const attempt = await enrollment.issueImportAttemptLease({
      operationId: lease.operationId,
      authorityId: AUTHORITY,
      provenance: PROVENANCE,
    });
    const binding = await enrollment.bindImportAttempt({
      operationId: lease.operationId,
      attemptId: attempt.attemptId,
      attemptGeneration: attempt.attemptGeneration,
      leaseToken: attempt.leaseToken,
      targetIdentity: { issuer: targetIssuer, realmId, subject: target.userId },
      digestFingerprint: createHash("sha256").update(material.credentialDigest).digest("hex"),
      provenance: PROVENANCE,
    });
    const importToken = tokenProvider("LAKESIDE_CREDENTIAL_IMPORT_WRITER");
    const dispatcher = createCredentialImportDispatcher({
      endpoint: `${targetIssuer}/lakeside-provision-transport`,
      issuer: targetIssuer,
      realmId,
      obtainAccessToken: importToken.obtainAccessToken,
    });
    await dispatcher.importCredential(binding, material.credentialDigest);
    await enrollment.reconcileImportAttempt({
      operationId: lease.operationId,
      attemptId: attempt.attemptId,
      provenance: PROVENANCE,
    });
    const activation = await enrollment.bindTargetActivation({
      operationId: lease.operationId,
      provenance: PROVENANCE,
    });
    await postAuthority("activate", "LAKESIDE_ACTIVATION_COORDINATOR", {
      accountId: activation.accountId,
      operationId: activation.operationId,
      userId: activation.userId,
      importReceiptId: activation.importReceiptId,
    });
    const unified = await enrollment.reconcileTargetActivation({
      operationId: lease.operationId,
      provenance: PROVENANCE,
    });
    if (unified.status !== "unified") throw new Error("Unified activation did not commit");
    return Object.freeze({ accountId: target.canonicalAccountId, userId: target.userId });
  } finally {
    await Promise.allSettled([coordinator.end(), fenceReaderPool.end(), receiptReaderPool.end()]);
  }
}
