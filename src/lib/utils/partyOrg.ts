/**
 * Party Organization utility functions
 * Used for displaying and validating party org values
 */

/**
 * Get organization level label and color
 * @param org - Organization value (0-100)
 * @returns Label and Tailwind color class
 */
export function getOrgLabel(org: number): { label: string; color: string } {
  if (org >= 90) return { label: "Dominant", color: "text-green-500" };
  if (org >= 70) return { label: "Strong", color: "text-green-400" };
  if (org >= 50) return { label: "Competitive", color: "text-yellow-400" };
  if (org >= 30) return { label: "Developing", color: "text-orange-400" };
  if (org >= 10) return { label: "Weak", color: "text-red-400" };
  return { label: "Minimal", color: "text-red-500" };
}

/**
 * Get organization bar color for visual display
 * @param org - Organization value (0-100)
 * @returns Tailwind background color class
 */
export function getOrgBarColor(org: number): string {
  if (org >= 70) return "bg-green-500";
  if (org >= 50) return "bg-yellow-500";
  if (org >= 30) return "bg-orange-500";
  return "bg-red-500";
}

/**
 * Calculate initial party org from state political lean (non-zero-sum)
 * Each party has a baseline presence plus bonus in favorable states.
 * @param politicalLean - State's political lean (-5 to +5)
 * @param partyId - Party identifier
 * @returns Initial organization value
 */
export function calculateInitialOrg(politicalLean: number, partyId: string): number {
  const BASELINE = 25; // Every major party has at least baseline organization
  const BONUS_PER_LEAN = 7; // Points gained per lean point in favorable direction

  if (partyId === "democrat") {
    // Democrats get bonus in blue states (negative lean)
    return BASELINE + Math.max(0, -politicalLean) * BONUS_PER_LEAN;
  }
  if (partyId === "republican") {
    // Republicans get bonus in red states (positive lean)
    return BASELINE + Math.max(0, politicalLean) * BONUS_PER_LEAN;
  }
  // Third parties start at 0
  return 0;
}

/**
 * Validate organization value
 * @param org - Organization value to validate
 * @returns true if valid (0-100)
 */
export function validateOrganization(org: number): boolean {
  return typeof org === "number" && org >= 0 && org <= 100;
}
