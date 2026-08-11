import { setSectorGrowth } from "@/lib/corporations/commands/sectorOperations/setSectorGrowth";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/growth — Update a sector's growth target.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return setSectorGrowth(request, { params });
}
