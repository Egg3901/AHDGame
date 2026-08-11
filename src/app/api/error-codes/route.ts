/**
 * GET /api/error-codes
 *
 * Returns a static, versioned catalog of all API error codes emitted by this server.
 * Intended for desktop client consumption — clients can map codes to user-facing messages
 * without hardcoding HTTP status strings.
 *
 * No auth required.
 * Increment `version` when new codes are added so clients can detect schema changes.
 */
import { NextResponse } from "next/server";

interface ErrorEntry {
  code: string;
  httpStatus: number;
  category: "validation" | "auth" | "not_found" | "system";
  message: string;
}

const ERROR_CATALOG: ErrorEntry[] = [
  {
    code: "BAD_REQUEST",
    httpStatus: 400,
    category: "validation",
    message: "Invalid request data",
  },
  {
    code: "UNAUTHORIZED",
    httpStatus: 401,
    category: "auth",
    message: "Authentication required",
  },
  {
    code: "FORBIDDEN",
    httpStatus: 403,
    category: "auth",
    message: "Forbidden",
  },
  {
    code: "NOT_FOUND",
    httpStatus: 404,
    category: "not_found",
    message: "Resource not found",
  },
  {
    code: "INTERNAL_ERROR",
    httpStatus: 500,
    category: "system",
    message: "Internal server error",
  },
];

export async function GET() {
  return NextResponse.json({
    version: "1",
    errors: ERROR_CATALOG,
  });
}
