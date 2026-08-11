import { expandSector } from "@/lib/corporations/commands/sectorOperations/expandSector";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/corporations/[id]/sectors — Expand into a new sector in a target state.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 409, 503
export async function POST(request: Request, { params }: RouteParams) {
  return expandSector(request, { params });
}
