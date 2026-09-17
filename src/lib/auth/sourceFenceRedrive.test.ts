import { describe, expect, it, vi } from "vitest";
import {
  SourceOwnershipProofError,
  SourceOwnershipProofOutcomeUnknownError,
  type SourceOwnershipProof,
  type SourceOwnershipReservation,
} from "./sourceOwnershipProof";
import { createSourceFenceRedriver } from "./sourceFenceRedrive";

const SOURCE_ISSUER = "https://source.test.lakesidegames.invalid";
const SOURCE_ACCOUNT = "507f1f77bcf86cd799439011";
const ACCOUNT = "abcdef12-abcd-4abc-8abc-abcdef123456";
const OPERATION = "12345678-90ab-4cde-b123-456789abcdef";
const PROOF_ID = "22345678-90ab-4cde-b123-456789abcdef";
const input = Object.freeze({
  canonicalAccountId: ACCOUNT,
  enrollmentOperationId: OPERATION,
  sourceAccountId: SOURCE_ACCOUNT,
  password: "fresh-password",
  provenance: "test:redrive",
});
const reservation: SourceOwnershipReservation = Object.freeze({
  version: 1,
  sourceIssuer: SOURCE_ISSUER,
  sourceSubject: SOURCE_ACCOUNT,
  canonicalAccountId: ACCOUNT,
  enrollmentOperationId: OPERATION,
});
const proof: SourceOwnershipProof = Object.freeze({
  proofId: PROOF_ID,
  version: 1,
  sourceIssuer: SOURCE_ISSUER,
  sourceAccountId: SOURCE_ACCOUNT,
  canonicalAccountId: ACCOUNT,
  enrollmentOperationId: OPERATION,
  snapshotVersion: 1,
  snapshotDigest: "a".repeat(64),
  method: "password",
  retainedMethods: Object.freeze(["password"]),
  observedAtMs: 1_000,
  expiresAtMs: 271_000,
  observationWindowMs: 30_000,
});

function fixture() {
  const reserveEnrollment = vi.fn(async () => reservation);
  const issuePasswordProof = vi.fn(async ({ reserveEnrollment: reserve }) => {
    await reserve({
      sourceIssuer: SOURCE_ISSUER,
      sourceSubject: SOURCE_ACCOUNT,
      signal: new AbortController().signal,
    });
    return proof;
  });
  const loadProof = vi.fn(async () => ({ proof, sourceNowMs: 2_000, expired: false }));
  const applySourceFence = vi.fn(async () =>
    Object.freeze({ status: "COMMITTED" as const, proofId: PROOF_ID })
  );
  const redrive = createSourceFenceRedriver({
    sourceIssuer: SOURCE_ISSUER,
    proofStore: { issuePasswordProof, loadProof },
    reserveEnrollment,
    applySourceFence,
  });
  return { redrive, reserveEnrollment, issuePasswordProof, loadProof, applySourceFence };
}

describe("source fence redrive", () => {
  it("re-proves under the exact same reservation and delegates one proof id to the writer", async () => {
    const f = fixture();
    await expect(f.redrive(input)).resolves.toEqual({ status: "COMMITTED", proofId: PROOF_ID });
    expect(f.reserveEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceIssuer: SOURCE_ISSUER,
        sourceSubject: SOURCE_ACCOUNT,
      })
    );
    expect(f.applySourceFence).toHaveBeenCalledWith({
      proofId: PROOF_ID,
      provenance: "test:redrive",
    });
  });

  it("rejects reservation drift before a proof or source fence can be claimed", async () => {
    const f = fixture();
    f.reserveEnrollment.mockResolvedValue({
      ...reservation,
      enrollmentOperationId: "32345678-90ab-4cde-b123-456789abcdef",
    });
    await expect(f.redrive(input)).rejects.toBeInstanceOf(SourceOwnershipProofError);
    expect(f.applySourceFence).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous durable proof by its original id without minting another", async () => {
    const f = fixture();
    f.issuePasswordProof.mockRejectedValue(new SourceOwnershipProofOutcomeUnknownError(PROOF_ID));
    await expect(f.redrive(input)).resolves.toMatchObject({
      status: "COMMITTED",
      proofId: PROOF_ID,
    });
    expect(f.loadProof).toHaveBeenCalledWith({ proofId: PROOF_ID });
    expect(f.issuePasswordProof).toHaveBeenCalledTimes(1);
  });

  it("reports an ambiguous absent proof and does not call the source writer", async () => {
    const f = fixture();
    f.issuePasswordProof.mockRejectedValue(new SourceOwnershipProofOutcomeUnknownError(PROOF_ID));
    f.loadProof.mockResolvedValue(null as never);
    await expect(f.redrive(input)).resolves.toEqual({
      status: "COMMIT_UNKNOWN",
      proofId: PROOF_ID,
    });
    expect(f.applySourceFence).not.toHaveBeenCalled();
  });

  it("rejects malformed or expanded input before any callback", async () => {
    const f = fixture();
    await expect(f.redrive({ ...input, sourceAccountId: "bad" })).rejects.toBeInstanceOf(TypeError);
    await expect(f.redrive({ ...input, extra: true } as never)).rejects.toBeInstanceOf(TypeError);
    expect(f.issuePasswordProof).not.toHaveBeenCalled();
  });
});
