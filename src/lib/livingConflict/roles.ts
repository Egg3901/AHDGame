import type { ConflictRole, RoleContext } from "./types";

/**
 * The default role resolver, sufficient for most conflicts: principals are
 * belligerents, the two great-power backers are backer_a / backer_b, bordering
 * nations are neighbors, aligned nations are bloc, everyone else is a bystander.
 *
 * A def with unusual structure (a pandemic where "belligerent" means "at the
 * epicentre") supplies its own resolver; this is the common case, not a
 * requirement.
 */
export function defaultRoleResolver(ctx: RoleContext): ConflictRole {
  if (ctx.backerA && ctx.countryId === ctx.backerA) return "backer_a";
  if (ctx.backerB && ctx.countryId === ctx.backerB) return "backer_b";
  if (ctx.belligerents.includes(ctx.countryId)) return "belligerent";
  if (ctx.neighbors.includes(ctx.countryId)) return "neighbor";
  if (ctx.blocMembers.includes(ctx.countryId)) return "bloc";
  return "bystander";
}

/** Resolve a nation's role in a conflict, given the conflict's own resolver. */
export function roleFor(
  resolver: (ctx: RoleContext) => ConflictRole,
  ctx: RoleContext
): ConflictRole {
  return resolver(ctx);
}
