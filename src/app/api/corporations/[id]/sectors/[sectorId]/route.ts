import { getCorporationSectorDetail } from "@/lib/corporations/queries/sectorDetail";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

// GET /api/corporations/[id]/sectors/[sectorId] — Return the full sector detail payload.
// Auth: public
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  return getCorporationSectorDetail(request, { params });
}
