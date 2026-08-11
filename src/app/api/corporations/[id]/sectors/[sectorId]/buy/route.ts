import { buyListedSector } from "@/lib/corporations/commands/sectorOperations/buyListedSector";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/buy — Buy a listed sector from another corporation.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 409
export async function POST(request: Request, { params }: RouteParams) {
  return buyListedSector(request, { params });
}
