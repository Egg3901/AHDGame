import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import {
  BootstrapRecoveryConflict,
  preview1991BootstrapRecovery,
  recover1991Bootstrap,
} from "@/lib/admin/recover1991Bootstrap";

const schema = z
  .object({ runId: z.string().regex(/^[a-f\d]{24}$/i), apply: z.boolean().default(false) })
  .strict();

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const db = await getDb();
    const plan = await preview1991BootstrapRecovery(db, parsed.data.runId);
    if (!parsed.data.apply) return NextResponse.json(plan);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let connected = true;
        const send = (event: object) => {
          if (!connected) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            connected = false;
          }
        };
        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15000);
        try {
          const result = await recover1991Bootstrap(db, {
            runId: parsed.data.runId,
            adminUsername: auth.admin.username,
            log: (message) => send({ type: "log", message }),
          });
          send({ type: "done", data: result });
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "Bootstrap recovery failed",
          });
        } finally {
          clearInterval(heartbeat);
          if (connected) controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof BootstrapRecoveryConflict) return errorResponse(409, error.message);
    return handleRouteError(error);
  }
}
