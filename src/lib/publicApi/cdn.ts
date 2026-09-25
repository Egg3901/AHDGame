/**
 * Machine-readable catalog of the public static CDN, surfaced at
 * `GET /api/public/v1/cdn`. External clients use it to construct asset URLs
 * instead of hardcoding the bucket layout. `cdnBase` reflects the build-time
 * `NEXT_PUBLIC_CDN_BASE` override, so a singleplayer deployment honestly
 * reports its local `/cdn` mirror rather than the production host.
 *
 * Everything listed is a public, unauthenticated file — the API key gates this
 * directory document, not the assets. Categories mirror the conventions
 * declared in `src/lib/images/`; a category appearing here asserts the URL
 * scheme, not that every possible slug exists on the bucket.
 */
import { CDN_BASE, CDN_GEO, CDN_HERO_SLUGS } from "@/lib/images/cdnUrls";
import {
  ACTION_IMAGE_SLUGS,
  countriesWithArt,
  erasWithCountryArt,
  erasWithGenericSet,
} from "@/lib/images/actionImages";
import {
  CDN_ACTION_IMAGE_URLS,
  CDN_CREATE_CHARACTER_IMAGES,
  CDN_HERO_LINCOLN_URL,
  CDN_LOGIN_IMAGES,
  CDN_LOGO_URL,
} from "@/lib/images/staticCdnAssets";
import { HISTORICAL_JUSTICE_IMAGE_URLS, SCOTUS_HERO_IMAGE_URL } from "@/lib/scotus/justiceImages";
import { TECH_PLACEHOLDER_IMAGE } from "@/lib/constants/techTree/images";

export interface PublicCdnCategory {
  /** Directory under `${cdnBase}/static/`. */
  name: string;
  description: string;
  /** Absolute URL templates; `{slug}`, `{era}`, `{country}`, `{file}` are placeholders. */
  urlTemplates: string[];
  /** File slugs known to be published, when the set is enumerable. */
  slugs?: readonly string[];
  notes?: string;
}

export interface PublicCdnCatalog {
  cdnBase: string;
  /** Root URL pattern every category template specializes. */
  urlPattern: string;
  defaultExtension: "webp";
  categories: PublicCdnCategory[];
  /** Named, fully-resolved asset URLs and slug sets for keyed collections. */
  assets: {
    logo: string;
    heroFallback: string;
    loginHeroByEra: Record<string, string>;
    actionCards: {
      urls: Record<string, string>;
      slugs: readonly string[];
      /** Eras whose every slug resolves under `actions/{era}/`. */
      eraGenericSets: string[];
      /** Era → countries that have at least one bespoke national image. */
      countryArt: Record<string, string[]>;
    };
    geoJson: Record<string, string>;
    scotusBuilding: string;
    techTierPlaceholder: string;
  };
}

function fileSlug(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/i, "");
}

const PRODUCTION_CDN_BASE = "https://cdn.ahousedividedgame.com";

function configuredAssetUrl(url: string): string {
  return url.startsWith(`${PRODUCTION_CDN_BASE}/`)
    ? `${CDN_BASE}${url.slice(PRODUCTION_CDN_BASE.length)}`
    : url;
}

function configuredAssetMap(assets: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(assets).map(([name, url]) => [name, configuredAssetUrl(url)])
  );
}

export function buildCdnCatalog(): PublicCdnCatalog {
  const staticBase = `${CDN_BASE}/static`;

  return {
    cdnBase: CDN_BASE,
    urlPattern: `${staticBase}/{category}/{slug}.{ext}`,
    defaultExtension: "webp",
    categories: [
      {
        name: "heroes",
        description: "Page hero banners.",
        urlTemplates: [`${staticBase}/heroes/{slug}.webp`],
        slugs: CDN_HERO_SLUGS,
        notes:
          "imf-logo is published as PNG (heroes/imf-logo.png). Commodity heroes also exist at commodity-{commodityKey} slugs not enumerated here.",
      },
      {
        name: "seals",
        description: "Country seals.",
        urlTemplates: [`${staticBase}/seals/{slug}.webp`],
        notes: "{slug} is the lowercase country id used across the public API (us, uk, de, ...).",
      },
      {
        name: "misc",
        description: "Miscellaneous static art.",
        urlTemplates: [`${staticBase}/misc/{slug}.webp`],
      },
      {
        name: "crises",
        description: "Crisis art keyed by source photo slug.",
        urlTemplates: [`${staticBase}/crises/{slug}.webp`],
      },
      {
        name: "pree",
        description: "Static art keyed by source photo slug.",
        urlTemplates: [`${staticBase}/pree/{slug}.webp`],
      },
      {
        name: "npp-politicians",
        description: "NPP politician portraits keyed by politician id.",
        urlTemplates: [`${staticBase}/npp-politicians/{slug}.webp`],
      },
      {
        name: "npp-avatars",
        description: "NPP avatars keyed by NPP id.",
        urlTemplates: [`${staticBase}/npp-avatars/{slug}.webp`],
      },
      {
        name: "landing",
        description: "Landing-page bento and showcase card images.",
        urlTemplates: [`${staticBase}/landing/{slug}.webp`],
        // Published set: TILE_IMAGES in src/app/_landing-v2/SandboxHome.tsx.
        slugs: [
          "state-metrics",
          "ballot-box",
          "legislative-combat",
          "industrial-empires",
          "global-markets",
          "newsroom",
          "central-banks",
          "world-1979",
        ],
      },
      {
        name: "flavor-cards",
        description: "Era leader portraits for the landing carousel.",
        urlTemplates: [`${staticBase}/flavor-cards/{slug}.webp`],
        // Only these three have licensed assets on the bucket; other card
        // slugs intentionally render image-free (licensing table in
        // src/components/landing/flavorCards.ts).
        slugs: ["bush", "deng", "major"],
      },
      {
        name: "login",
        description: "Era hero images for login and register.",
        urlTemplates: [`${staticBase}/login/{slug}.webp`],
        slugs: Object.keys(CDN_LOGIN_IMAGES).map((era) => `login-${era}`),
        notes: "{slug} is login-{era}; eras are also keyed under assets.loginHeroByEra.",
      },
      {
        name: "actions",
        description:
          "Action-card art. Era-generic files live under actions/{era}/; a subset of eras and countries has bespoke national art under actions/{era}/{country}/.",
        urlTemplates: [
          `${staticBase}/actions/{slug}.webp`,
          `${staticBase}/actions/{era}/{slug}.webp`,
          `${staticBase}/actions/{era}/{country}/{slug}.webp`,
        ],
        slugs: ACTION_IMAGE_SLUGS,
        notes: "See assets.actionCards for which eras and countries have art published.",
      },
      {
        name: "create-character",
        description: "Era hero images for character creation.",
        urlTemplates: [`${staticBase}/create-character/create-{era}.webp`],
        slugs: Object.keys(CDN_CREATE_CHARACTER_IMAGES).map((era) => `create-${era}`),
        notes: "Empty slug list means none are published; clients should use assets.heroFallback.",
      },
      {
        name: "scotus",
        description: "U.S. Supreme Court building hero and historical justice portraits.",
        urlTemplates: [`${staticBase}/scotus/{slug}.webp`],
        slugs: ["building", ...Object.values(HISTORICAL_JUSTICE_IMAGE_URLS).map(fileSlug)],
      },
      {
        name: "tech",
        description:
          "Tech-tree tier art: one image per corporate-lane decade, or per sector and decade.",
        urlTemplates: [
          `${staticBase}/tech/corp/{slug}.webp`,
          `${staticBase}/tech/sector/{sectorType}/{slug}.webp`,
        ],
        notes: "tech/placeholder.webp is served until a tier image is uploaded.",
      },
      {
        name: "maps",
        description: "Regional GeoJSON boundary files.",
        urlTemplates: [`${staticBase}/maps/{file}`],
        slugs: Object.values(CDN_GEO).map((url) => url.slice(url.lastIndexOf("/") + 1)),
        notes: "Name-to-URL map is under assets.geoJson.",
      },
    ],
    assets: {
      logo: configuredAssetUrl(CDN_LOGO_URL),
      heroFallback: configuredAssetUrl(CDN_HERO_LINCOLN_URL),
      loginHeroByEra: configuredAssetMap(CDN_LOGIN_IMAGES),
      actionCards: {
        urls: configuredAssetMap(CDN_ACTION_IMAGE_URLS),
        slugs: ACTION_IMAGE_SLUGS,
        eraGenericSets: erasWithGenericSet(),
        countryArt: Object.fromEntries(
          erasWithCountryArt().map((era) => [era, countriesWithArt(era)])
        ),
      },
      geoJson: { ...CDN_GEO },
      scotusBuilding: configuredAssetUrl(SCOTUS_HERO_IMAGE_URL),
      techTierPlaceholder: configuredAssetUrl(TECH_PLACEHOLDER_IMAGE),
    },
  };
}
