/** Lowercase URL for an org's page (built-ins like "EU" → ".../eu"). */
export function orgHref(org: { id: string }): string {
  return `/world/international-organizations/${org.id.toLowerCase()}`;
}

/** Resolve an org from a case-insensitive URL segment, or undefined. */
export function resolveOrgBySegment<T extends { id: string }>(
  orgs: T[],
  segment: string
): T | undefined {
  const s = segment.toLowerCase();
  return orgs.find((o) => o.id.toLowerCase() === s);
}
