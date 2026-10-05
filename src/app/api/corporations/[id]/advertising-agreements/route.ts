import { listAdvertisingAgreements, proposeAdvertisingAgreement } from "@/lib/advertising/commands";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET: list this corp's advertising agreements (CEO only). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return listAdvertisingAgreements(id);
}

/** POST: propose an advertising agreement (CEO only). */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return proposeAdvertisingAgreement(request, id);
}
