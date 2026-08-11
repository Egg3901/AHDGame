/**
 * Structured logger for critical paths.
 *
 * A thin wrapper over `console.*` (which the Sentry `consoleLoggingIntegration`
 * already mirrors into GlitchTip Logs) that enforces a consistent shape:
 * `[component] message { ...data }`. Using it on critical paths (turn engine,
 * auth, stock purchases, elections) makes those logs greppable by component and
 * gives errors a captured exception with structured context — instead of bare
 * `console.error(err)` calls that lose the surrounding state.
 *
 * This is NOT a mass replacement for console.*; only reach for it where the
 * structured context and Sentry capture actually earn their keep.
 */
import * as Sentry from "@sentry/nextjs";

type LogData = Record<string, unknown>;

function format(component: string, message: string): string {
  return `[${component}] ${message}`;
}

export const logger = {
  info(component: string, message: string, data?: LogData): void {
    // Below warn threshold, so this reaches Logs only via explicit breadcrumb —
    // enough for forensic context without capturing an event.
    console.log(format(component, message), data ?? "");
    Sentry.addBreadcrumb({
      category: component,
      level: "info",
      message,
      data,
    });
  },

  warn(component: string, message: string, data?: LogData): void {
    // console.warn is mirrored to GlitchTip Logs by the consoleLoggingIntegration.
    console.warn(format(component, message), data ?? "");
  },

  /**
   * Log an error. If an `error` is supplied it is captured as a Sentry
   * exception (with component tag + data), otherwise a warning-level message is
   * captured so the failure is still queryable.
   */
  error(component: string, message: string, error?: unknown, data?: LogData): void {
    console.error(format(component, message), error ?? "", data ?? "");
    if (error !== undefined) {
      Sentry.captureException(error, {
        level: "error",
        tags: { component },
        extra: { message, ...data },
      });
    } else {
      Sentry.captureMessage(format(component, message), {
        level: "error",
        tags: { component },
        extra: data,
      });
    }
  },

  /** Unrecoverable failure — same as error() but flagged fatal for triage. */
  fatal(component: string, message: string, error?: unknown, data?: LogData): void {
    console.error(format(component, `FATAL: ${message}`), error ?? "", data ?? "");
    Sentry.captureException(error ?? new Error(message), {
      level: "fatal",
      tags: { component },
      extra: { message, ...data },
    });
  },
};
