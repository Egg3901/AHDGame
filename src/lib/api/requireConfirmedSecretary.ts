import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import {
  actingScopeRefusal,
  type ActingScopeMember,
  type CabinetLeverScope,
} from "@/lib/cabinet/actingScope";

/**
 * Refuse a barred lever to an acting (unconfirmed) cabinet holder.
 *
 * Returns a 403 when the seat is held in an acting capacity and `scope` is one
 * the Senate's confirmation is protecting, and `null` otherwise, so routes read
 * as one line after they have already established the caller holds the seat:
 *
 *     const denied = requireConfirmedSecretary(member, "stance");
 *     if (denied) return denied;
 *
 * Deliberately not an authorization check. The caller IS the secretary; this is
 * the ceiling on what that office can do before it has been confirmed, so it
 * belongs after the holder check and carries a different message from it.
 *
 * Admins are exempted. These routes are the only write path for most of these
 * levers, and there is no admin-side equivalent of the stance or doctrine
 * endpoint, so honouring the restriction against an admin would leave ops unable to repair
 * a department whose seat happens to be filled in an acting capacity.
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
