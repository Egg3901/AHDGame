"use client";

/**
 * Parse error message from an API response.
 * Use when fetch returns !res.ok to show user-friendly feedback.
 */
export async function getApiErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
    if (body?.reason) return `${body.error ?? "Error"}: ${body.reason}`;
  } catch {
    // Response wasn't JSON
  }
  return res.status === 500
    ? "Something went wrong. Please try again."
    : `Request failed (${res.status})`;
}

/**
 * Check response and throw if not ok, with parsed error message.
 * Use with try/catch for cleaner error handling.
 */
export async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  const msg = await getApiErrorMessage(res);
  throw new Error(msg);
}
