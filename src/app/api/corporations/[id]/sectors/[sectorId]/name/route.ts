import { renameSector } from "@/lib/corporations/commands/sectorOperations/renameSector";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/name — Rename a sector's display name.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return renameSector(request, { params });
}
