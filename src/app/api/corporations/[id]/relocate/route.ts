import { relocateHeadquarters } from "@/lib/corporations/commands/capitalOperations/relocateHeadquarters";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/corporations/[id]/relocate — Relocate corporation headquarters and handle payment/currency effects.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 409, 429, 500, 503
export async function POST(request: Request, { params }: RouteParams) {
  return relocateHeadquarters(request, { params });
}
