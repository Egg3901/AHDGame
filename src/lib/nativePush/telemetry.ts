import type { Event } from "@sentry/nextjs";

/** Registration credentials must not enter error or transaction request data. */
export function scrubPushRequest<T extends Pick<Event, "request">>(event: T): T {
  if (event.request?.url?.split("?")[0].endsWith("/api/push/device")) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  return event;
}
