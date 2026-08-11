import { requireAdmin, type AdminAuthResult } from "./requireAdmin";

type AdminAuthOk = Extract<AdminAuthResult, { ok: true }>;

/**
 * Wrap a route handler so it only runs for admins. Replaces the boilerplate:
 *
 *   const auth = await requireAdmin();
 *   if (!auth.ok) return auth.response;
 *   // ... handler body, references auth.admin
 *
 * with:
 *
 *   export const GET = withAdminAuth(async (auth, request, ctx) => {
 *     // ... handler body, references auth.admin
 *   });
 *
 * The first handler argument is the resolved (success-narrowed) auth object;
 * remaining arguments (request, route context) are forwarded as-is.
 */
export function withAdminAuth<Args extends unknown[], R>(
  handler: (auth: AdminAuthOk, ...args: Args) => Promise<R>
): (...args: Args) => Promise<R | Response> {
  return async (...args: Args) => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    return handler(auth, ...args);
  };
}
