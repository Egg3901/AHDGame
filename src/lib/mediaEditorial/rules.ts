/**
 * Media editorial stance. A publisher chooses economic and social positions,
 * audience fit controls advertising availability, and local audience share
 * sets the maximum favorability nudge through mediaAudienceFit.
 */
export interface EditorialPosition {
  economic: number;
  social: number;
}

export const EDITORIAL_POSITION_LIMIT = 5;
export const EDITORIAL_MAX_AUDIENCE_LOSS = 0.25;
export const EDITORIAL_MAX_FAVORABILITY_PER_TURN = 0.5;

function boundedAxis(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-EDITORIAL_POSITION_LIMIT, Math.min(EDITORIAL_POSITION_LIMIT, value));
}

function isNeutralPosition(position: EditorialPosition): boolean {
  return position.economic === 0 && position.social === 0;
}

export function normalizeEditorialPosition(
  value?: Partial<EditorialPosition> | null
): EditorialPosition {
  return {
    economic: boundedAxis(value?.economic),
    social: boundedAxis(value?.social),
  };
}

/** Audience availability falls by at most 25 percent at maximum stance distance. */
export function mediaAudienceFit(
  stance?: Partial<EditorialPosition> | null,
  audienceLean?: Partial<EditorialPosition> | null
): number {
  const position = normalizeEditorialPosition(stance);
  if (isNeutralPosition(position)) return 1;
  const audience = normalizeEditorialPosition(audienceLean);
  const distance =
    Math.abs(position.economic - audience.economic) + Math.abs(position.social - audience.social);
  return 1 - EDITORIAL_MAX_AUDIENCE_LOSS * (distance / (EDITORIAL_POSITION_LIMIT * 4));
}

/** Aligned candidates gain at most 0.5 favorability, scaled by delivered audience share. */
export function editorialFavorabilityNudge(
  stance?: Partial<EditorialPosition> | null,
  candidate?: Partial<EditorialPosition> | null,
  audienceShare = 0
): number {
  const position = normalizeEditorialPosition(stance);
  if (isNeutralPosition(position)) return 0;
  const target = normalizeEditorialPosition(candidate);
  const distance =
    Math.abs(position.economic - target.economic) + Math.abs(position.social - target.social);
  const alignment = Math.max(0, 1 - distance / (EDITORIAL_POSITION_LIMIT * 2));
  const share = Number.isFinite(audienceShare) ? Math.max(0, Math.min(1, audienceShare)) : 0;
  return Math.min(EDITORIAL_MAX_FAVORABILITY_PER_TURN, 0.5 * alignment * share);
}

/** Local competing outlets share the total favorability influence pool. */
export function editorialAudienceFavorabilityNudge(
  outlets: readonly { stance?: Partial<EditorialPosition> | null; audienceShare: number }[],
  candidate?: Partial<EditorialPosition> | null
): number {
  const total = outlets.reduce(
    (sum, outlet) =>
      sum + editorialFavorabilityNudge(outlet.stance, candidate, outlet.audienceShare),
    0
  );
  return Math.min(EDITORIAL_MAX_FAVORABILITY_PER_TURN, Math.max(0, total));
}
