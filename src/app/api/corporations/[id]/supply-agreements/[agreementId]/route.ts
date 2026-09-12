import { updateSupplyAgreement } from "@/lib/corporations/commands/supplyAgreements";

interface RouteParams {
  params: Promise<{ id: string; agreementId: string }>;
}

/** PATCH: accept, counter, or cancel a supply agreement. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id, agreementId } = await params;
  return updateSupplyAgreement(request, id, agreementId);
}
