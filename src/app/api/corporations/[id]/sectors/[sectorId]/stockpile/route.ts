import { setSectorStockpile } from "@/lib/corporations/commands/sectorOperations/setSectorStockpile";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/stockpile — Toggle sell-all vs build-inventory.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return setSectorStockpile(request, { params });
}
