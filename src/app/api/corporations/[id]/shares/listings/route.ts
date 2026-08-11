import { createShareListing } from "@/lib/corporations/commands/shareTrading/createShareListing";
import { getShareListingsView } from "@/lib/corporations/queries/shareListings";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/corporations/[id]/shares/listings — Return open listings and their pending offers.
// Auth: requireBasicAuth
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  return getShareListingsView(request, { params });
}

// POST /api/corporations/[id]/shares/listings — Create a private share listing.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 409
export async function POST(request: Request, { params }: RouteParams) {
  return createShareListing(request, { params });
}
