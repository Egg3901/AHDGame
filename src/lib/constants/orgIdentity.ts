/**
 * Per-organization visual identity for the International Organizations page —
 * an accent colour pair plus seal/labels. Built-ins use the palettes from the
 * Claude Design import; player-created orgs get a deterministic accent derived
 * from their slug so the same org always renders the same colour.
 */
import type { BuiltInInternationalOrganizationId } from "./internationalOrganizations";
import { ORGANIZATION_CATEGORY_META, type OrganizationCategory } from "./orgCategory";

export interface OrgIdentity {
  /** Primary accent (hex). Drives the `--org` CSS var. */
  accent: string;
  /** Lighter accent (hex). Drives `--org-soft`. */
  accentSoft: string;
  /** Seal glyph — short text or a symbol (fallback when no logo image). */
  glyph: string;
  /** Optional emblem image URL (built-in real-world flags; custom uploads). */
  logoSrc?: string;
  /** Dossier group label, e.g. "Global · Political". */
  group: string;
  /** Headquarters city, or "—" when unknown (customs). */
  hq: string;
  /** Founding year, or 0 when unknown (customs). */
  founded: number;
}

// Keyed by the shared union rather than a duplicated literal list, so a new
// built-in that forgets its identity fails to compile instead of silently
// falling through to the custom-org accent hash.
export const BUILTIN_ORG_IDENTITY: Record<BuiltInInternationalOrganizationId, OrgIdentity> = {
  UN: {
    accent: "#5b92e5",
    accentSoft: "#a9c9f5",
    glyph: "UN",
    logoSrc:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Flag_of_the_United_Nations.svg/330px-Flag_of_the_United_Nations.svg.png",
    group: "Political",
    hq: "New York",
    founded: 1945,
  },
  NATO: {
    accent: "#2f5fb0",
    accentSoft: "#9bb6e0",
    glyph: "✦",
    logoSrc:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Flag_of_NATO.svg/330px-Flag_of_NATO.svg.png",
    group: "Security",
    hq: "Brussels",
    founded: 1949,
  },
  EU: {
    accent: "#f4c430",
    accentSoft: "#ffe082",
    glyph: "★",
    logoSrc:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Flag_of_Europe.svg/330px-Flag_of_Europe.svg.png",
    group: "Economic",
    hq: "Brussels",
    founded: 1958,
  },
  COMMONWEALTH: {
    accent: "#1c3f94",
    accentSoft: "#ffd25e",
    glyph: "C",
    logoSrc: "/orgs/commonwealth.svg",
    group: "Political",
    hq: "London",
    founded: 1949,
  },
  WARSAW_PACT: {
    accent: "#b3202c",
    accentSoft: "#e58d95",
    glyph: "★",
    // Identity `founded` mirrors the game's foundedYear (user decision), not
    // the historical treaty year.
    logoSrc: "/orgs/warsaw-pact.svg",
    group: "Security",
    hq: "Moscow",
    founded: 1952,
  },
  NON_ALIGNED: {
    accent: "#7a5ea8",
    accentSoft: "#c9b6e4",
    glyph: "◇",
    logoSrc: "/orgs/non-aligned-movement.svg",
    group: "Political",
    // The movement has no permanent secretariat; Belgrade hosted its founding
    // conference and stands in as its seat.
    hq: "Belgrade",
    founded: 1961,
  },
  COMECON: {
    accent: "#1b4f72",
    accentSoft: "#7fb3d5",
    glyph: "◈",
    // Real CMEA founding year (Jan 1949 Moscow) — matches def.foundedYear.
    logoSrc: "/orgs/comecon.svg",
    group: "Economic",
    hq: "Moscow",
    founded: 1949,
  },
};

/** Stable 32-bit string hash (djb2). Deterministic — no Math.random. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Convert HSL (h 0-360, s/l 0-1) to a #rrggbb hex string. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to255 = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/**
 * Resolve the identity for any org. The `group` label is category-driven (so
 * all orgs read uniformly); built-ins keep their fixed accent/seal/HQ, while
 * customs derive a hue from the slug hash and a glyph from the first letter of
 * their short name.
 */
export function resolveOrgIdentity(
  orgId: string,
  isCustom: boolean,
  name: string,
  category: OrganizationCategory,
  /** Uploaded emblem URL for custom orgs (built-ins use their fixed flag). */
  logoSrc?: string | null
): OrgIdentity {
  const group = ORGANIZATION_CATEGORY_META[category].label;
  if (!isCustom && orgId in BUILTIN_ORG_IDENTITY) {
    return { ...BUILTIN_ORG_IDENTITY[orgId as keyof typeof BUILTIN_ORG_IDENTITY], group };
  }
  const hue = hashString(orgId) % 360;
  const glyphSource = name.trim() || orgId;
  return {
    accent: hslToHex(hue, 0.65, 0.6),
    accentSoft: hslToHex(hue, 0.7, 0.75),
    glyph: glyphSource.charAt(0).toUpperCase(),
    logoSrc: logoSrc ?? undefined,
    group,
    hq: "—",
    founded: 0,
  };
}
