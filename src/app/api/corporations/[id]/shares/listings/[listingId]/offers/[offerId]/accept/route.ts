import { acceptShareOffer } from "@/lib/corporations/commands/shareTrading/acceptShareOffer";

interface RouteParams {
  params: Promise<{ id: string; listingId: string; offerId: string }>;
}

// POST /api/corporations/[id]/shares/listings/[listingId]/offers/[offerId]/accept — Accept a pending private listing offer.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 409, 503
export async function POST(request: Request, { params }: RouteParams) {
  return acceptShareOffer(request, { params });
}
