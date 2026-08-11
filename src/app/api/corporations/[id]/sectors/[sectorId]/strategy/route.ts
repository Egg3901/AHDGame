import { setSectorStrategy } from "@/lib/corporations/commands/sectorOperations/setSectorStrategy";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/strategy — Start a sector strategy transition.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return setSectorStrategy(request, { params });
}
