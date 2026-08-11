import { setSectorPricing } from "@/lib/corporations/commands/sectorOperations/setSectorPricing";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/pricing — Set a sector's pricing posture.
// Auth: requireBasicAuth (CEO)
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return setSectorPricing(request, { params });
}
