"use client";

/**
 * Client-side JSON fetch with built-in observability.
 *
 * The pervasive `fetch(url).then(r => r.json())` pattern silently parses error
 * response bodies as if they were data — a 500/401 turns into an empty list,
 * $0 balance, or stale UI that looks "real," and nothing reaches GlitchTip.
 * `fetchJson` throws on network failure and non-2xx, and reports genuine faults
 * (network + 5xx) to Sentry tagged with the calling `feature`. Callers keep
 * their own try/catch to drive an error state.
 *
 * 4xx responses are thrown (so callers can react) but not captured — they are
 * usually expected (auth/validation). Pass `allowStatuses` to treat specific
 * codes (e.g. 403 for a disabled feature) as a normal `null`-ish outcome the
 * caller handles, by checking `HttpError.status` in the catch.
 */
import { captureClientException } from "@/lib/observability/sentryClientLazy";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string
  ) {
    super(`Request failed: ${status} ${url}`);
    this.name = "HttpError";
  }
}

export async function fetchJson<T = unknown>(
  input: string,
  init?: RequestInit & { feature?: string }
): Promise<T> {
  const { feature = "unknown", ...rest } = init ?? {};

  let res: Response;
  try {
    res = await fetch(input, rest);
  } catch (err) {
    captureClientException(err, {
      tags: { kind: "fetch", phase: "network", feature },
      extra: { url: input },
    });
    throw err;
  }

  if (!res.ok) {
    const err = new HttpError(res.status, input);
    // 5xx is our fault and must be captured; 4xx is usually expected and is
    // surfaced to the caller without adding noise.
    if (res.status >= 500) {
      captureClientException(err, {
        tags: { kind: "fetch", phase: "http", status: res.status, feature },
        extra: { url: input },
      });
    }
    throw err;
  }

  return (await res.json()) as T;
}
