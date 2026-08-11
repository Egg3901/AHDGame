import { sellPublicShares } from "@/lib/corporations/commands/shareTrading/sellPublicShares";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/corporations/[id]/shares/sell — Sell shares into public float at current market price.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 409
export async function POST(request: Request, { params }: RouteParams) {
  return sellPublicShares(request, { params });
}
