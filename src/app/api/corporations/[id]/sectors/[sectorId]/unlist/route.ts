import { unlistSectorForSale } from "@/lib/corporations/commands/sectorOperations/unlistSectorForSale";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/unlist — Remove a sector from the secondary market.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return unlistSectorForSale(request, { params });
}
