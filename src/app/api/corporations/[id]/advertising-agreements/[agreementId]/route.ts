import { updateAdvertisingAgreement } from "@/lib/advertising/commands";

interface RouteParams {
  params: Promise<{ id: string; agreementId: string }>;
}

/** PATCH: accept, counter, or cancel an advertising agreement (CEO only). */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id, agreementId } = await params;
  return updateAdvertisingAgreement(request, id, agreementId);
}
