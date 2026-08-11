import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { badRequest, handleRouteError } from "@/lib/api/errors";
import {
  startAllocationProfileInBackground,
  getLastAllocationProfileResult,
  getLastAllocationProfileError,
  getCurrentCaptureState,
  formatAllocationProfile,
  flattenAllocationProfile,
  isAllocationProfileCaptureInProgress,
  AllocationProfileBusyError,
  DEFAULT_SAMPLING_INTERVAL_BYTES,
} from "@/lib/observability/allocationProfile";

/*
 * Async leak-diagnostic endpoint.
 *
 * POST /api/admin/debug/allocation-profile?durationMs=600000&samplingIntervalBytes=4096
 *   Kicks off a V8 sampling-heap-profile capture in the background and
 *   returns 202 IMMEDIATELY with timestamps. The HTTP response does not wait
 *   for the sample to complete — necessary because Cloudflare disconnects
 *   clients after ~100s and any sample longer than that would 524.
 *
 *   Returns 409 if another capture is already in progress (V8's sampling
 *   state is process-global; concurrent captures would corrupt each other).
 *
 * GET /api/admin/debug/allocation-profile?topN=25
 *   Returns the last completed profile (or last error) plus a `state` field:
 *     - "idle"        : no capture has ever run
 *     - "running"     : capture in progress, no completed result yet
 *     - "completed"   : capture finished successfully
 *     - "failed"      : capture finished with an error
 *   If a capture is running AND a previous completed result exists, the
 *   state is "running" but `lastCompleted` carries the previous result so
 *   callers can still inspect baselines while a new capture is in flight.
 *
 * Workflow:
 *   1. POST to start (e.g., durationMs=600000)
 *   2. Continue using the app — the capture runs server-side
 *   3. ~durationMs later, GET to retrieve the formatted report
 *
 * Auth: requireAdmin on both verbs
 * Errors: 400 (bad params), 403 (not admin), 409 (POST only — already running)
 */

const MAX_DURATION_MS = 10 * 60 * 1000;
const MIN_DURATION_MS = 5_000;
const DEFAULT_DURATION_MS = 5 * 60 * 1000;
const MAX_TOP_N = 100;

interface StartResponse {
  state: "started";
  startedAt: string;
  durationMs: number;
  samplingIntervalBytes: number;
  estimatedFinishAt: string;
}

interface ResultResponse {
  state: "idle" | "running" | "completed" | "failed";
  current?: ReturnType<typeof getCurrentCaptureState>;
  lastCompleted?: {
    startedAt: string;
    stoppedAt: string;
    durationMs: number;
    samplingIntervalBytes: number;
    totalSelfSize: number;
    topNFormatted: string;
    topN: Array<{
      functionName: string;
      url: string;
      lineNumber: number;
      selfSize: number;
      callPath: string[];
    }>;
  };
  lastError?: { message: string; at: string };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const durationParam = url.searchParams.get("durationMs");
    const samplingIntervalParam = url.searchParams.get("samplingIntervalBytes");

    const durationMs = durationParam ? Number(durationParam) : DEFAULT_DURATION_MS;
    if (
      !Number.isFinite(durationMs) ||
      durationMs < MIN_DURATION_MS ||
      durationMs > MAX_DURATION_MS
    ) {
      return NextResponse.json(
        badRequest(`durationMs must be between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}`).toJson(),
        { status: 400 }
      );
    }

    const samplingIntervalBytes = samplingIntervalParam
      ? Number(samplingIntervalParam)
      : DEFAULT_SAMPLING_INTERVAL_BYTES;
    if (!Number.isFinite(samplingIntervalBytes) || samplingIntervalBytes < 1024) {
      return NextResponse.json(badRequest("samplingIntervalBytes must be at least 1024").toJson(), {
        status: 400,
      });
    }

    if (isAllocationProfileCaptureInProgress()) {
      return NextResponse.json(
        {
          error: "Another allocation-profile capture is already in progress",
          current: getCurrentCaptureState(),
        },
        { status: 409 }
      );
    }

    try {
      const started = startAllocationProfileInBackground({
        durationMs,
        samplingIntervalBytes,
      });
      const response: StartResponse = { state: "started", ...started };
      return NextResponse.json(response, { status: 202 });
    } catch (err) {
      if (err instanceof AllocationProfileBusyError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const topNParam = url.searchParams.get("topN");
    const topN = topNParam ? Number(topNParam) : 25;
    if (!Number.isFinite(topN) || topN < 1 || topN > MAX_TOP_N) {
      return NextResponse.json(badRequest(`topN must be between 1 and ${MAX_TOP_N}`).toJson(), {
        status: 400,
      });
    }

    const current = getCurrentCaptureState();
    const result = getLastAllocationProfileResult();
    const errorState = getLastAllocationProfileError();

    let state: ResultResponse["state"];
    if (current) state = "running";
    else if (errorState && (!result || errorState.at > result.stoppedAt)) state = "failed";
    else if (result) state = "completed";
    else state = "idle";

    const response: ResultResponse = { state };
    if (current) response.current = current;
    if (errorState) response.lastError = errorState;
    if (result) {
      const flat = flattenAllocationProfile(result.profile);
      const totalSelfSize = flat.reduce((sum, n) => sum + n.selfSize, 0);
      const sorted = flat
        .filter((n) => n.functionName !== "(root)" && n.selfSize > 0)
        .sort((a, b) => b.selfSize - a.selfSize)
        .slice(0, topN);
      response.lastCompleted = {
        startedAt: result.startedAt,
        stoppedAt: result.stoppedAt,
        durationMs: result.durationMs,
        samplingIntervalBytes: result.samplingIntervalBytes,
        totalSelfSize,
        topNFormatted: formatAllocationProfile(result.profile, topN),
        topN: sorted,
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
