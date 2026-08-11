export type ErrorContext = {
  component?: string;
  action?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};

export function logError(error: unknown, context: ErrorContext): void {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(
    JSON.stringify({
      timestamp,
      level: "error",
      message: errorMessage,
      stack,
      ...context,
    })
  );
}

export function logWarning(message: string, context: ErrorContext): void {
  const timestamp = new Date().toISOString();

  console.warn(
    JSON.stringify({
      timestamp,
      level: "warning",
      message,
      ...context,
    })
  );
}
