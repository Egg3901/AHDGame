import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import {
  actingScopeRefusal,
  type ActingScopeMember,
  type CabinetLeverScope,
} from "@/lib/cabinet/actingScope";

/**
 * Apply the shared cabinet authority policy after the caller's holder check.
 * Acting and confirmed secretaries currently have the same departmental powers.
 * The historical helper name is retained for existing route callers.
 */
export function requireConfirmedSecretary(
  member: ActingScopeMember,
  scope: CabinetLeverScope,
  isAdmin = false
): NextResponse | null {
  if (isAdmin) return null;
  const refusal = actingScopeRefusal(member, scope);
  if (!refusal) return null;
  return NextResponse.json(forbidden(refusal).toJson(), { status: 403 });
}
