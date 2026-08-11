import { listSectorForSale } from "@/lib/corporations/commands/sectorOperations/listSectorForSale";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/list — List a sector for sale on the secondary market.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return listSectorForSale(request, { params });
}
