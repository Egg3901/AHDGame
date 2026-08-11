import { setSectorPolicy } from "@/lib/corporations/commands/sectorOperations/setSectorPolicy";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/policy — Update a sector's production policy target.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return setSectorPolicy(request, { params });
}
