import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";

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
  return errorResponse(status, message, { code: code, extra: { ok: false } });
}
