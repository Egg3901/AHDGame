// Wall-clock 24h window (not turn-counter based). Most party-governance
// actions use the newest of account creation, character creation, and
// recent party join; some flows (like leadership elections) intentionally
// opt out of the party-join anchor so veteran players are not blocked just
// for moving countries or rejoining a party.
export const NEW_CHARACTER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface NewCharacterCooldownInput {
  userCreatedAt: Date;
  characterCreatedAt: Date;
  partyJoinedAt?: Date | null;
  includePartyJoinedAt?: boolean;
  now?: Date;
}

export interface NewCharacterCooldownResult {
  blocked: boolean;
  unblockAt: Date;
}

export function isInNewCharacterCooldown(
  input: NewCharacterCooldownInput
): NewCharacterCooldownResult {
  const now = input.now ?? new Date();
  const anchors: number[] = [input.userCreatedAt.getTime(), input.characterCreatedAt.getTime()];
  if (input.includePartyJoinedAt !== false && input.partyJoinedAt) {
    anchors.push(input.partyJoinedAt.getTime());
  }
  const latest = Math.max(...anchors);
  const unblockAt = new Date(latest + NEW_CHARACTER_COOLDOWN_MS);
  return {
    blocked: now.getTime() < unblockAt.getTime(),
    unblockAt,
  };
}
