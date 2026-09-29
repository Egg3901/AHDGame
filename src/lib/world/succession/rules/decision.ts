/**
 * Negotiated dissolution needs an available decision, an enacted parent mandate
 * and consent to the same immutable proposal revision from every participant.
 * evaluateSuccessionApproval never turns a historical date into an outcome.
 */
export interface SuccessionConsent {
  entityId: string;
  settlementId: string;
  revision: number;
  choice: "approve" | "reject";
}

export interface SuccessionApprovalInput {
  settlementId: string;
  revision: number;
  availableFromYear: number;
  currentYear: number;
  requiredParticipants: readonly string[];
  parentMandate: { settlementId: string; revision: number } | null;
  consents: readonly SuccessionConsent[];
}

export interface SuccessionApproval {
  status:
    "invalid" | "unavailable" | "awaiting-mandate" | "rejected" | "awaiting-consent" | "ready";
  reasons: string[];
  missingParticipants: string[];
  rejectingParticipants: string[];
}

export function evaluateSuccessionApproval(input: SuccessionApprovalInput): SuccessionApproval {
  const result = (
    status: SuccessionApproval["status"],
    reasons: string[],
    missingParticipants: string[] = [],
    rejectingParticipants: string[] = []
  ): SuccessionApproval => ({ status, reasons, missingParticipants, rejectingParticipants });
  const participants = [...input.requiredParticipants].sort();
  if (
    !input.settlementId.trim() ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isFinite(input.currentYear) ||
    !Number.isFinite(input.availableFromYear) ||
    participants.length < 2 ||
    participants.some((id) => !id.trim()) ||
    new Set(participants).size !== participants.length
  ) {
    return result("invalid", ["A valid proposal revision and distinct participants are required."]);
  }
  if (input.currentYear < input.availableFromYear)
    return result("unavailable", [`The decision opens in ${input.availableFromYear}.`]);
  if (
    input.parentMandate?.settlementId !== input.settlementId ||
    input.parentMandate.revision !== input.revision
  )
    return result("awaiting-mandate", [
      "The parent legislature has not enacted this settlement mandate.",
    ]);
  const choices = new Map<string, SuccessionConsent["choice"]>();
  for (const consent of input.consents) {
    if (
      consent.settlementId !== input.settlementId ||
      consent.revision !== input.revision ||
      !participants.includes(consent.entityId)
    )
      continue;
    if (choices.has(consent.entityId))
      return result("invalid", ["Duplicate consent records require reconciliation."]);
    choices.set(consent.entityId, consent.choice);
  }
  const rejecting = participants.filter((id) => choices.get(id) === "reject");
  const missing = participants.filter(
    (id) => choices.get(id) !== "approve" && choices.get(id) !== "reject"
  );
  if (rejecting.length)
    return result(
      "rejected",
      ["A participant rejected this proposal; revised terms require fresh consent."],
      missing,
      rejecting
    );
  if (missing.length)
    return result(
      "awaiting-consent",
      ["Every participant must approve this proposal revision."],
      missing
    );
  return result("ready", ["The enacted mandate and participant consents authorize settlement."]);
}
