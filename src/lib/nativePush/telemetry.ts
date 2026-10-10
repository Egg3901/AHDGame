import type { Event } from "@sentry/nextjs";

/** Session cookies and device credentials must not enter error or transaction request data. */
export function scrubPushRequest<T extends Pick<Event, "request">>(event: T): T {
  const path = event.request?.url?.split("?")[0];
  if (event.request && (path?.endsWith("/api/push/device") || path?.endsWith("/api/push/feed"))) {
    event.request.url = path;
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  return event;
}
