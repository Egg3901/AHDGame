/**
 * Heavy static assets served from Cloudflare R2 (`cdn.ahousedividedgame.com`)
 * instead of `public/`. Serving these from the CDN keeps their bandwidth off
 * the Railway container (free egress, edge-cached) and avoids the per-request
 * `/_next/image` re-encode.
 *
 * These URLs are matched by `bypassNextImageOptimization`, so any `next/image`
 * using them MUST pass `unoptimized` — the CDN host is intentionally absent
 * from `next.config.ts` `remotePatterns` so the optimizer can never proxy
 * (and re-bill egress for) them.
 *
 * Logo / Lincoln hero: `public/ahd-logo.png`, `public/lincoln-memorial.jpg` via
 * `scripts/upload-static-to-r2.mjs`.
 *
 * Action card images: `scripts/upload-action-images-to-r2.mjs`.
 */
export const CDN_LOGO_URL = "https://cdn.ahousedividedgame.com/static/ahd-logo.png";
export const CDN_HERO_LINCOLN_URL =
  "https://cdn.ahousedividedgame.com/static/lincoln-memorial.webp";

const CDN_STATIC_BASE = "https://cdn.ahousedividedgame.com/static";

/**
 * THE era → hero-image source of truth. Every surface that shows an era hero
 * (login, register) resolves through {@link getLoginImage}; there is no second
 * era→image map. (`eraThemes.EraConfig` used to carry a parallel
 * `loginImageSlug` field that nothing read — removed rather than left to drift.)
 *
 * Every era below IS uploaded and live on R2, including the two wireframe eras:
 * the CRT login panel renders its image ghosted behind scanlines rather than
 * going image-free, and `/register` shows it as the hero backdrop.
 *
 * To add an era: upload the WebP to R2 at the path shown, then add the key.
 *
 * Source images (all verified public domain / CC-licensed from Wikimedia Commons):
 *
 * 1991 — Brandenburg Gate NYE crowd, 1 Jan 1990 (CC BY-SA 3.0 DE, Hartmut Reiche/Bundesarchiv)
 *   Source: https://upload.wikimedia.org/wikipedia/commons/1/1f/Bundesarchiv_Bild_183-1990-0101-008%2C_Berlin%2C_Brandenburger_Tor%2C_Silvesterfeier.jpg
 *   R2 target: /static/login/login-1991.webp
 *
 * 1999 — WTO protests, Seattle, 30 Nov 1999 (CC BY-SA 2.0, Steve Kaiser)
 *   Source: https://upload.wikimedia.org/wikipedia/commons/6/63/WTO_protests_in_Seattle_November_30_1999.jpg
 *   R2 target: /static/login/login-1999.webp
 *
 * 2007 — G8 Heiligendamm leaders group photo, 8 Jun 2007 (GODL free commercial, PM Office India)
 *   Source: https://upload.wikimedia.org/wikipedia/commons/e/e7/A_Group_photo_of_Leaders_of_the_G-8_and_Outreach_Countries_at_G_8_Summit_in_Heiligendamm%2C_Germany_on_June_08%2C_2007.jpg
 *   R2 target: /static/login/login-2007.webp
 *
 * 2019 — House of Commons debating Brexit deal, 19 Oct 2019 (CC BY 3.0, UK Parliament / Jessica Taylor)
 *   Source: https://upload.wikimedia.org/wikipedia/commons/8/83/House_of_Commons_debating_Brexit_deal_-_19_October_2019.jpg
 *   R2 target: /static/login/login-2019.webp
 *
 * 2023 — NATO Vilnius Summit family photo, 11 Jul 2023 (CC BY 2.0, Simon Dawson / No 10 Downing St)
 *   Source: https://upload.wikimedia.org/wikipedia/commons/f/f3/Family_photo_from_2023_NATO_Vilnius_summit_%2853038388599%29.jpg
 *   R2 target: /static/login/login-2023.webp
 *
 * 1953 high-res alt (CC BY 2.0, USMC Archives): https://upload.wikimedia.org/wikipedia/commons/2/2f/Korean_War_Armistice_Signing%2C_27_July_1953_%2819864802878%29.jpg
 * 1979 alt: search commons.wikimedia.org/wiki/Category:1979 for SALT II / Afghan invasion imagery.
 */
export const CDN_LOGIN_IMAGES: Record<string, string> = {
  "1953": `${CDN_STATIC_BASE}/login/login-1953.webp`, // Korean War Armistice signing — CC BY 2.0, USMC Archives
  "1979": `${CDN_STATIC_BASE}/login/login-1979.webp`, // Carter at Three Mile Island — PD (federal gov)
  "1991": `${CDN_STATIC_BASE}/login/login-1991.webp`, // Brandenburg Gate NYE — CC BY-SA 3.0 DE, Bundesarchiv
  "1999": `${CDN_STATIC_BASE}/login/login-1999.webp`, // WTO Seattle protests — CC BY-SA 2.0, Steve Kaiser
  "2007": `${CDN_STATIC_BASE}/login/login-2007.webp`, // G8 Heiligendamm — GODL, PM Office India
  "2019": `${CDN_STATIC_BASE}/login/login-2019.webp`, // House of Commons Brexit — CC BY 3.0, UK Parliament
  "2023": `${CDN_STATIC_BASE}/login/login-2023.webp`, // NATO Vilnius summit — CC BY 2.0, No 10 Downing St
};

/**
 * Hero image for an era. Used by both `/login` and `/register`. Unknown eras
 * (worlds seeded before the era system) fall back to the era-neutral Lincoln
 * memorial rather than rendering a broken image.
 */
export function getLoginImage(era: string | number): string {
  return CDN_LOGIN_IMAGES[String(era)] ?? CDN_HERO_LINCOLN_URL;
}

/**
 * Era-specific character-creation page hero images.
 *
 * None of these have ever been sourced/uploaded (every `create-<year>.webp` key
 * 404s on R2) — the map is intentionally empty so `getCreateCharacterImage`
 * always falls back to the Lincoln Memorial hero below instead of rendering a
 * broken image. To add a real one: source + optimize the WebP, upload it to
 * R2 at `static/create-character/create-<year>.webp` via
 * `scripts/upload-create-character-images-to-r2.mjs`, then re-add the entry
 * here.
 *
 * Suggested dimensions: ~1600×900, WebP, ~150–250 KB.
 * Sourcing guidance is in `scripts/create-character-images/README.md`.
 */
export const CDN_CREATE_CHARACTER_IMAGES: Record<string, string> = {};

export function getCreateCharacterImage(era: string | number): string {
  return CDN_CREATE_CHARACTER_IMAGES[String(era)] ?? CDN_HERO_LINCOLN_URL;
}

const CDN_ACTIONS_BASE = "https://cdn.ahousedividedgame.com/static/actions";

/** Action card + actions-page hero images (WebP on R2). */
export const CDN_ACTION_IMAGE_URLS = {
  campaign: `${CDN_ACTIONS_BASE}/campaign.webp`,
  advertise: `${CDN_ACTIONS_BASE}/advertise.webp`,
  fundraise: `${CDN_ACTIONS_BASE}/fundraise.webp`,
  flipflop: `${CDN_ACTIONS_BASE}/flipflop.webp`,
  debatePrep: `${CDN_ACTIONS_BASE}/debatePrep.webp`,
  canvass: `${CDN_ACTIONS_BASE}/canvass.webp`,
  convertCash: `${CDN_ACTIONS_BASE}/convertCash.webp`,
  buildDonorBase: `${CDN_ACTIONS_BASE}/buildDonorBase.webp`,
  poll: `${CDN_ACTIONS_BASE}/poll.webp`,
  pollLarge: `${CDN_ACTIONS_BASE}/pollLarge.webp`,
  hero: `${CDN_ACTIONS_BASE}/hero.webp`,
} as const;

export const CDN_HERO_ACTIONS_URL = CDN_ACTION_IMAGE_URLS.hero;
