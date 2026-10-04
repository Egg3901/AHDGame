import { describe, expect, it } from "vitest";
import { evaluateSuccessionApproval, type SuccessionApprovalInput } from "./decision";
const input: SuccessionApprovalInput = {
  settlementId: "cs-1",
  revision: 2,
  availableFromYear: 1992,
  currentYear: 1992,
  requiredParticipants: ["CZ2", "SK"],
  parentMandate: { settlementId: "cs-1", revision: 2 },
  consents: [
    { entityId: "CZ2", settlementId: "cs-1", revision: 2, choice: "approve" },
    { entityId: "SK", settlementId: "cs-1", revision: 2, choice: "approve" },
  ],
};
describe("negotiated dissolution approval", () => {
  it("does not dissolve a federation just because its historical date passed", () => {
    expect(
      evaluateSuccessionApproval({ ...input, currentYear: 2027, parentMandate: null }).status
    ).toBe("awaiting-mandate");
    expect(evaluateSuccessionApproval({ ...input, currentYear: 2027, consents: [] }).status).toBe(
      "awaiting-consent"
    );
  });
  it("requires availability even if all political approvals are present", () => {
    expect(evaluateSuccessionApproval({ ...input, currentYear: 1991 }).status).toBe("unavailable");
  });
  it("requires fresh participant consent when negotiated terms change", () => {
    const result = evaluateSuccessionApproval({
      ...input,
      revision: 3,
      parentMandate: { settlementId: "cs-1", revision: 3 },
    });
    expect(result.status).toBe("awaiting-consent");
    expect(result.missingParticipants).toEqual(["CZ2", "SK"]);
  });
  it("preserves rejection and authorizes only a fully approved settlement", () => {
    expect(evaluateSuccessionApproval(input).status).toBe("ready");
    const rejected = evaluateSuccessionApproval({
      ...input,
      consents: [input.consents[0], { ...input.consents[1], choice: "reject" }],
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectingParticipants).toEqual(["SK"]);
  });
  it("does not count consent from another proposal or country", () => {
    const result = evaluateSuccessionApproval({
      ...input,
      consents: [
        { ...input.consents[0], settlementId: "other" },
        { ...input.consents[1], entityId: "OTHER" },
      ],
    });
    expect(result.status).toBe("awaiting-consent");
  });
  it("rejects duplicate approvals and vacuous participant sets", () => {
    expect(
      evaluateSuccessionApproval({ ...input, consents: [...input.consents, input.consents[0]] })
        .status
    ).toBe("invalid");
    expect(evaluateSuccessionApproval({ ...input, requiredParticipants: [] }).status).toBe(
      "invalid"
    );
    expect(
      evaluateSuccessionApproval({ ...input, requiredParticipants: ["SK", "SK"] }).status
    ).toBe("invalid");
  });
});

it("does not reuse a parliamentary mandate for a different revision", () => {
  expect(
    evaluateSuccessionApproval({ ...input, parentMandate: { settlementId: "cs-1", revision: 1 } })
      .status
  ).toBe("awaiting-mandate");
});
