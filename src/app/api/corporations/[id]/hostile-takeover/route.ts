import { runHostileTakeover } from "@/lib/corporations/commands/takeovers/hostileTakeover";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/corporations/[id]/hostile-takeover — Absorb a subsidiary after paying minority holders.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429, 503
export async function POST(request: Request, { params }: RouteParams) {
  return runHostileTakeover(request, { params });
}
