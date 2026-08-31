/**
 * POST /api/whitehouse/cabinet/acting — legacy US-only path.
 *
 * Kept so existing clients keep working. The logic lives in
 * `appointActingCabinetMember`, which the country-scoped route also calls.
 * A delegator rather than an HTTP redirect, because redirecting a POST is
 * method-fragile.
 */
import { appointActingCabinetMember } from "@/lib/cabinet/appointActing";

export async function POST(request: Request) {
  return appointActingCabinetMember(request, "US");
}
