import { abandonSector } from "@/lib/corporations/commands/sectorOperations/abandonSector";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/abandon — Abandon a sector and restore it to the unowned pool.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return abandonSector(request, { params });
}
