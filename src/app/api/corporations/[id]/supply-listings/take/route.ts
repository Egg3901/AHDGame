import { takeSupplyListing } from "@/lib/corporations/commands/takeSupplyListing";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST: take a standing board listing, forming an active supply agreement. */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return takeSupplyListing(request, id);
}
