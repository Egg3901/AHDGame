import { buildCapacity } from "@/lib/corporations/commands/sectorOperations/buildCapacity";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// POST /api/corporations/[id]/sectors/[sectorId]/build — Order, cancel, mothball
// or reactivate a sector's productive capacity (plants tier only).
// Auth: requireBasicAuth (CEO only)
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return buildCapacity(request, { params });
}
