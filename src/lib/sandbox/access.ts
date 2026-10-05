/**
 * Who sees the "Switch to sandbox" link.
 *
 * Staff and active Supporter+ patrons always do. Testers invited without
 * supporter perks need two things: the `gameConfig.sandboxTesterAccessEnabled`
 * switch on, and an admin-set `sandboxAccessGrantedAt` on their account.
 * Neither touches the supporter fields (`patreonTier`, `patreonExpiresAt`,
 * `supporterProvider`), so a grant never unlocks a supporter perk.
 */
export interface SandboxAccessInput {
  isAdmin?: boolean;
  isModerator?: boolean;
  patreonTier?: string | null;
  isPatronActive?: boolean;
  /** `gameConfig.sandboxTesterAccessEnabled`. */
  testerAccessEnabled?: boolean;
  /** `users.sandboxAccessGrantedAt` is set. */
  testerGranted?: boolean;
}

export function hasSandboxAccess(input: SandboxAccessInput): boolean {
  if (input.isAdmin || input.isModerator) return true;
  const supporter =
    (input.patreonTier === "supporter-plus" || input.patreonTier === "supporter-plus-plus") &&
    input.isPatronActive === true;
  if (supporter) return true;
  return input.testerAccessEnabled === true && input.testerGranted === true;
}
