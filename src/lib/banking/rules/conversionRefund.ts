/** A cancelled unpublished receipt restores only cash proved delivered. */
export interface RefundLeg {
  kind: "debit" | "credit";
  amount: number;
  applied: boolean;
}
export function quoteUnpublishedUnderwritingRefund(input: {
  published: boolean;
  legs: readonly RefundLeg[];
}): number[] {
  if (input.published)
    throw new Error("Published instruments cannot be refunded as pending underwriting");
  return input.legs.map((leg) => {
    if (!Number.isFinite(leg.amount) || leg.amount < 0)
      throw new Error("Invalid underwriting amount");
    return leg.applied ? (leg.kind === "debit" ? leg.amount : -leg.amount) : 0;
  });
}
