import { fillShareOrder } from "@/lib/corporations/commands/shareTrading/fillShareOrder";

interface RouteParams {
  params: Promise<{ id: string; orderId: string }>;
}

// POST /api/corporations/[id]/shares/orders/[orderId]/fill — Fill another holder's open order.
// Auth: requireBasicAuth
// Errors: 400, 403, 404, 409, 503
export async function POST(request: Request, { params }: RouteParams) {
  return fillShareOrder(request, { params });
}
