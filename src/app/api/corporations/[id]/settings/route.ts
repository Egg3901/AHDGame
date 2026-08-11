import { updateCorporationSettings } from "@/lib/corporations/commands/capitalOperations/updateCorporationSettings";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/corporations/[id]/settings — Update corporation budgets, salary, and dividend settings.
// Auth: requireBasicAuth
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  return updateCorporationSettings(request, { params });
}
