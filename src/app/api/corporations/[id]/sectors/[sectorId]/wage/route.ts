import { setSectorWageLevel } from "@/lib/corporations/commands/sectorOperations/setSectorWageLevel";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/wage — Set a sector's wage level (Labour system).
// Auth: requireBasicAuth (CEO). Gated on labourSystemMode ≥ "wages".
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return setSectorWageLevel(request, { params });
}
