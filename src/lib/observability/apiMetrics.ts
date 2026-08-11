/**
 * RED-metrics wrapper for API route handlers.
 *
 * RED = Rate, Errors, Duration. Wrapping a route handler in `withApiMetrics`:
 *   - opens an `http.server` span so the request's duration + status land in
 *     GlitchTip's trace view tagged with `api.route`;
 *   - tags the SLO availability signal (`slo.api_availability` = status < 500)
 *     so the API error budget is queryable;
 *   - captures non-2xx responses and thrown errors as Sentry events with the
 *     route name, so a spike in 4xx/5xx on one route is visible and grouped.
 *
 * Apply to the highest-traffic / highest-value routes (check GlitchTip
 * Performance to pick them) — not every route. It is a thin pass-through: the
 * handler's Response is returned unchanged.
 */
import * as Sentry from "@sentry/nextjs";
import { SLO_TAG } from "./slo";

const SPAN_STATUS_OK = 1 as const;
const SPAN_STATUS_ERROR = 2 as const;

// A Next.js App Router route handler: (request, context?) => Response | Promise<Response>.
type RouteHandler<Args extends unknown[]> = (...args: Args) => Response | Promise<Response>;

export function withApiMetrics<Args extends unknown[]>(
  routeName: string,
  handler: RouteHandler<Args>
): RouteHandler<Args> {
  return async (...args: Args): Promise<Response> => {
    const span = Sentry.startInactiveSpan({
      name: routeName,
      op: "http.server",
      attributes: { "api.route": routeName },
    });
    Sentry.setTag("api.route", routeName);

    try {
      const response = await handler(...args);
      const status = response.status;

      span.setAttribute("http.status_code", status);
      span.setStatus({ code: status < 500 ? SPAN_STATUS_OK : SPAN_STATUS_ERROR });

      // SLO: availability counts anything < 500 as "up" (a 4xx is the caller's
      // fault, not an outage).
      Sentry.setTag(SLO_TAG.API_AVAILABILITY, status < 500 ? "true" : "false");

      // This is a METRICS wrapper, not an error reporter: it deliberately emits
      // NO GlitchTip issue of its own. The error signal already lives elsewhere
      // — routes throw through handleRouteError (which Sentry.captureException's
      // the real stack) and client fetch failures are captured by fetchJson —
      // so a synthetic "API 500" message here would just double-capture into a
      // second, separately-grouped issue (the exact telemetry fragmentation the
      // mongoMonitor per-collection captureMessage caused). The error RATE is
      // instead read from span status + the slo.api_availability tag on sampled
      // traces; a breadcrumb keeps the status in the pre-error trail.
      if (status >= 400) {
        span.setAttribute("api.status", status);
        Sentry.addBreadcrumb({
          category: "api",
          level: status >= 500 ? "error" : "warning",
          message: `API ${status}: ${routeName}`,
          data: { "api.route": routeName, "api.status": status },
        });
      }

      return response;
    } catch (err) {
      span.setStatus({
        code: SPAN_STATUS_ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      Sentry.setTag(SLO_TAG.API_AVAILABILITY, "false");
      // Re-throw so Next's error boundary / instrumentation still captures the
      // full exception; the tag above records the availability hit either way.
      throw err;
    } finally {
      span.end();
    }
  };
}
