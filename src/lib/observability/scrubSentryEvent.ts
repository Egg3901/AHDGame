import type * as Sentry from "@sentry/nextjs";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/** Keep diagnostic stacks while removing account data from error payloads. */
export function scrubSentryEvent<T extends Sentry.ErrorEvent>(event: T): T {
  delete event.user;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.env;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
  }
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = value.value.replace(EMAIL, "[email]");
  }
  if (event.message) event.message = event.message.replace(EMAIL, "[email]");
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = crumb.message.replace(EMAIL, "[email]");
    delete crumb.data;
  }
  delete event.extra;
  return event;
}
