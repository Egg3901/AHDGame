export interface WarEmergencySectorShift {
  sectorType: string;
  pct: number;
  durationTurns: number;
}

/** Shared balance table used by both crisis and legacy event response paths. */
export const CIVIL_DEFENSE_SECTOR_SHIFTS = {
  fund: [
    { sectorType: "retail", pct: -20, durationTurns: 12 },
    { sectorType: "entertainment", pct: -12, durationTurns: 12 },
    { sectorType: "construction", pct: 20, durationTurns: 12 },
    { sectorType: "manufacturing", pct: 20, durationTurns: 12 },
    { sectorType: "defense", pct: 20, durationTurns: 12 },
  ],
  drills: [
    { sectorType: "retail", pct: -10, durationTurns: 8 },
    { sectorType: "entertainment", pct: -6, durationTurns: 8 },
    { sectorType: "construction", pct: 10, durationTurns: 8 },
    { sectorType: "manufacturing", pct: 12, durationTurns: 8 },
    { sectorType: "defense", pct: 15, durationTurns: 8 },
  ],
} as const satisfies Record<string, readonly WarEmergencySectorShift[]>;
