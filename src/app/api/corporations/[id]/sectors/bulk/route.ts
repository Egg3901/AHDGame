import { bulkSetSectorOperations } from "@/lib/corporations/commands/sectorOperations/bulkSetSectorOperations";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/corporations/[id]/sectors/bulk — set growth and/or production across
// every holding of a sector type (or all types) in one country, atomically.
// Auth: requireBasicAuth (CEO only). Errors: 400, 403, 404, 429.
export async function POST(request: Request, { params }: RouteParams) {
  return bulkSetSectorOperations(request, { params });
}
