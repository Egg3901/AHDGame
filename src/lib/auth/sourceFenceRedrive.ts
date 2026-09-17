import {
  SourceOwnershipProofError,
  SourceOwnershipProofOutcomeUnknownError,
  type ReserveEnrollment,
  type SourceOwnershipProof,
  type SourceOwnershipProofStore,
} from "./sourceOwnershipProof";
import type { SourceFenceResult } from "./sourceFenceWriter";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX24 = /^[0-9a-f]{24}$/;
const CONTROL = /[\x00-\x1f\x7f]/;

export interface SourceFenceRedriveConfig {
  readonly sourceIssuer: string;
  readonly proofStore: SourceOwnershipProofStore;
  readonly reserveEnrollment: ReserveEnrollment;
  readonly applySourceFence: (
    input: Readonly<{ proofId: string; provenance: string }>
  ) => Promise<SourceFenceResult>;
}

export interface SourceFenceRedriveInput {
  readonly canonicalAccountId: string;
  readonly enrollmentOperationId: string;
  readonly sourceAccountId: string;
  readonly password: string;
  readonly provenance: string;
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.isWellFormed() &&
    value === value.trim() &&
    !CONTROL.test(value)
  );
}

function proofMatches(
  proof: SourceOwnershipProof,
  binding: SourceFenceRedriveInput,
  issuer: string
) {
  return (
    proof.sourceIssuer === issuer &&
    proof.sourceAccountId === binding.sourceAccountId &&
    proof.canonicalAccountId === binding.canonicalAccountId &&
    proof.enrollmentOperationId === binding.enrollmentOperationId
  );
}

/**
 * Re-proves source password ownership under the same immutable enrollment
 * operation, then delegates the only source mutation to applySourceFence.
 * It never invents a new operation and never retries an ambiguous proof with
 * a new id. A durable ambiguous proof is reconciled by its original proof id.
 */
export function createSourceFenceRedriver(config: SourceFenceRedriveConfig) {
  if (
    !config ||
    !safeText(config.sourceIssuer, 512) ||
    typeof config.proofStore?.issuePasswordProof !== "function" ||
    typeof config.proofStore?.loadProof !== "function" ||
    typeof config.reserveEnrollment !== "function" ||
    typeof config.applySourceFence !== "function"
  ) {
    throw new TypeError("Invalid source fence redrive configuration");
  }

  return async function redriveSourceFence(
    input: SourceFenceRedriveInput
  ): Promise<SourceFenceResult> {
    if (
      !exactKeys(input, [
        "canonicalAccountId",
        "enrollmentOperationId",
        "password",
        "provenance",
        "sourceAccountId",
      ]) ||
      !UUID.test(input.canonicalAccountId) ||
      !UUID.test(input.enrollmentOperationId) ||
      !HEX24.test(input.sourceAccountId) ||
      !safeText(input.password, 1024) ||
      !safeText(input.provenance, 256)
    ) {
      throw new TypeError("Invalid source fence redrive input");
    }
    const binding = Object.freeze({ ...input });
    const reserveExact: ReserveEnrollment = async (request) => {
      const reservation = await config.reserveEnrollment(request);
      if (
        reservation.version !== 1 ||
        reservation.sourceIssuer !== config.sourceIssuer ||
        reservation.sourceSubject !== binding.sourceAccountId ||
        reservation.canonicalAccountId !== binding.canonicalAccountId ||
        reservation.enrollmentOperationId !== binding.enrollmentOperationId
      ) {
        throw new SourceOwnershipProofError("enrollment reservation does not match");
      }
      return reservation;
    };

    let proof: SourceOwnershipProof;
    try {
      proof = await config.proofStore.issuePasswordProof({
        sourceAccountId: binding.sourceAccountId,
        password: binding.password,
        reserveEnrollment: reserveExact,
      });
    } catch (error) {
      if (!(error instanceof SourceOwnershipProofOutcomeUnknownError)) throw error;
      const loaded = await config.proofStore.loadProof({ proofId: error.proofId });
      if (!loaded) return Object.freeze({ status: "COMMIT_UNKNOWN", proofId: error.proofId });
      proof = loaded.proof;
    }
    if (!proofMatches(proof, binding, config.sourceIssuer)) {
      throw new SourceOwnershipProofError("ownership proof binding does not match");
    }
    return config.applySourceFence(
      Object.freeze({ proofId: proof.proofId, provenance: binding.provenance })
    );
  };
}
