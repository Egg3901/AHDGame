import { NextResponse } from "next/server";

export type PublicApiErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "INVALID_COUNTRY"
  | "INVALID_METRIC"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export function publicError(
  code: PublicApiErrorCode,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}
