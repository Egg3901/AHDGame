import * as Sentry from "@sentry/nextjs";
export const dynamic = "force-dynamic";

class SentryExampleAPIError extends Error {
  constructor(message: string | undefined) {
    super(message);
    this.name = "SentryExampleAPIError";
  }
}

// GET /api/sentry-example-api — Always throws an error to verify Sentry error monitoring is working.
// Auth: public
// Errors: (none — always throws)
export function GET() {
  Sentry.logger.info("Sentry example API called");
  throw new SentryExampleAPIError(
    "This error is raised on the backend called by the example page."
  );
}
