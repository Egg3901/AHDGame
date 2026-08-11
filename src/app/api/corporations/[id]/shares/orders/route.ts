import { placeShareOrder } from "@/lib/corporations/commands/shareTrading/placeShareOrder";
import { getShareOrdersView } from "@/lib/corporations/queries/shareOrders";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/corporations/[id]/shares/orders — Return open orders, orderbook, and market orders.
// Auth: requireBasicAuth
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  return getShareOrdersView(request, { params });
}

// POST /api/corporations/[id]/shares/orders — Place a limit buy or sell order.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 409
export async function POST(request: Request, { params }: RouteParams) {
  return placeShareOrder(request, { params });
}
