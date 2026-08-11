import { cancelSectorStrategy } from "@/lib/corporations/commands/sectorOperations/cancelSectorStrategy";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/strategy/cancel — Cancel an in-progress sector strategy transition.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return cancelSectorStrategy(request, { params });
}
