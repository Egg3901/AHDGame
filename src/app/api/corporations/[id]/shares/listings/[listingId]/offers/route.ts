import { submitShareOffer } from "@/lib/corporations/commands/shareTrading/submitShareOffer";

interface RouteParams {
  params: Promise<{ id: string; listingId: string }>;
}

// POST /api/corporations/[id]/shares/listings/[listingId]/offers — Submit an offer against a private share listing.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 503
export async function POST(request: Request, { params }: RouteParams) {
  return submitShareOffer(request, { params });
}
