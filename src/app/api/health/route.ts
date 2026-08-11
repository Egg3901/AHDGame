import { NextResponse } from "next/server";

export const runtime = "edge";

// GET /api/health - Returns a lightweight liveness response for deploy probes and uptime monitors.
// Auth: public
// Errors: (none)
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      checks: { app: "ok" },
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-transform",
      },
    }
  );
}
