import { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { BootstrapMode } from "@/lib/admin/bootstrapGameWorld";
import { resetAndBootstrapGameWorld } from "@/lib/admin/resetAndBootstrapGameWorld";
import { isKnownPreset } from "@/lib/seeds/presetSelector";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

const resetSchema = z.object({
  bootstrap: z.boolean().optional(),
  mode: z.enum(["vacant", "historical"]).optional(),
  skipRegionalCouncil: z.boolean().optional(),
  /**
   * Start the world in a live pre-iteration "founding" phase (chambers vacant +
   * cycle-0 founding election seats every political nation; date pinned to the
   * era start until it completes). Only honored on a full bootstrap reset.
   *
   * OMIT to get the preset's intended default (1953-default founds; every other
   * preset does not — see `presetDefaultsToFoundingPhase`). `true` forces it on
   * for any historical bootstrap, `false` forces it off.
   */
  preIteration: z.boolean().optional(),
  iteration: z
    .object({
      type: z.enum(["Alpha", "Beta", "Iteration"]),
      number: z.number(),
    })
    .optional(),
});

/**
 * Resolve the caller's founding-phase intent, preserving the difference between
 * "not specified" and "explicitly off".
 *
 * Returning `undefined` lets `resetAndBootstrapGameWorld` apply the preset
 * default, which is what makes the plain admin "Reset + Historical Bootstrap"
 * button (which sends no `preIteration` key at all) produce a working founding
 * phase on a 1953 world. The body flag wins over the query string; the
 * orchestrator still refuses to found a `seedOnly` / vacant reset, so this
 * function does not repeat that guard.
 */
function resolvePreIterationOption(
  body: { preIteration?: boolean },
  searchParams: URLSearchParams
): boolean | undefined {
  if (typeof body.preIteration === "boolean") return body.preIteration;
  const query = searchParams.get("preIteration");
  if (query === null) return undefined;
  return query === "1" || query === "true";
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("stream") === "1") {
    return handleStreamingReset(request, searchParams);
  }

  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const deleteProfiles = searchParams.get("deleteProfiles") === "true";
    const preset = searchParams.get("preset") ?? DEFAULT_SEED_PRESET;
    const bootstrapFromQuery = searchParams.get("bootstrap") === "true";

    if (!isKnownPreset(preset)) {
      return NextResponse.json(
        {
          error: `Unknown preset "${preset}". Valid presets: 1953-default, 1979-default, 1991-default, 1999-default, 2007-default, 2019-default, 2023-default, empty, 2019-no-parties`,
        },
        { status: 400 }
      );
    }

    const parsed = await parseJsonBody(request, resetSchema);
    const body = parsed.success ? parsed.data : {};
    const bootstrap = body.bootstrap === true || bootstrapFromQuery;
    const mode: BootstrapMode = body.mode === "vacant" ? "vacant" : "historical";
    const skipRegionalCouncil = body.skipRegionalCouncil === true;
    const iteration = body.iteration;
    // Founding phase only makes sense on a full historical bootstrap: it seeds
    // chambers vacant and relies on the ensure* battery (bootstrap-only) to
    // spawn the founding races. `resetAndBootstrapGameWorld` enforces that and
    // fills in the preset default when this is undefined.
    const preIteration = resolvePreIterationOption(body, searchParams);

    const db = await getDb();
    const { reset, logs } = await resetAndBootstrapGameWorld({
      db,
      mode: bootstrap ? mode : "historical",
      preset,
      skipRegionalCouncil,
      resetReference: true,
      deleteProfiles,
      seedOnly: !bootstrap,
      adminUsername: admin.username,
      iteration,
      preIteration,
    });

    if (deleteProfiles) {
      await clearAuthCookie("admin_reset:delete_profiles");
    }

    return NextResponse.json({
      ...reset,
      bootstrap,
      bootstrapMode: bootstrap ? mode : null,
      logs,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function handleStreamingReset(
  request: Request,
  searchParams: URLSearchParams
): Promise<Response> {
  const encoder = new TextEncoder();

  const auth = await requireAdmin();
  const parsed = await parseJsonBody(request, resetSchema);
  const body = parsed.success ? parsed.data : {};

  const deleteProfiles = searchParams.get("deleteProfiles") === "true";
  const preset = searchParams.get("preset") ?? DEFAULT_SEED_PRESET;
  const bootstrapFromQuery = searchParams.get("bootstrap") === "true";
  const bootstrap = body.bootstrap === true || bootstrapFromQuery;
  const mode: BootstrapMode = body.mode === "vacant" ? "vacant" : "historical";
  const skipRegionalCouncil = body.skipRegionalCouncil === true;
  const iteration = body.iteration;
  const preIteration = resolvePreIterationOption(body, searchParams);

  if (!auth.ok) {
    return new Response(`data: ${JSON.stringify({ type: "error", message: "Unauthorized" })}\n\n`, {
      status: 401,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  if (!isKnownPreset(preset)) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: `Unknown preset "${preset}"` })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { admin } = auth;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {}
      };

      try {
        const db = await getDb();

        const { reset, logs } = await resetAndBootstrapGameWorld({
          db,
          mode: bootstrap ? mode : "historical",
          preset,
          skipRegionalCouncil,
          resetReference: true,
          deleteProfiles,
          seedOnly: !bootstrap,
          adminUsername: admin.username,
          iteration,
          preIteration,
          log: (msg: string) => send({ type: "log", message: msg }),
        });

        if (deleteProfiles) {
          await clearAuthCookie("admin_reset:delete_profiles");
        }

        send({
          type: "done",
          data: { ...reset, bootstrap, bootstrapMode: bootstrap ? mode : null, logs },
        });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Reset failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
