import { buyPublicShares } from "@/lib/corporations/commands/shareTrading/buyPublicShares";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/corporations/[id]/shares/buy — Buy shares from public float at current market price.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 503
export async function POST(request: Request, { params }: RouteParams) {
  return buyPublicShares(request, { params });
}
