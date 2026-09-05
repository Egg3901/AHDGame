import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { PRIVATE_PAGE_CACHE_CONTROL } from "./src/lib/cacheHeaders";

// Railway's build context no longer exposes the .git directory, so `git
// rev-parse` fails on every deploy build (#2772). Prefer Railway's injected
// commit SHA and fall back to git only for local/CI builds that still have it.
const gitRevParseHead = (): string | null => {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

// Full commit SHA used as the Sentry/GlitchTip release identifier. Tagging
// every event with a release ties errors to a specific deploy AND matches the
// source-map artifacts the Sentry webpack plugin uploads under this release, so
// stacks symbolicate. Exported via env so the three Sentry configs (which run
// in separate runtimes) all read the same value.
const SENTRY_RELEASE = process.env.RAILWAY_GIT_COMMIT_SHA || gitRevParseHead() || "unknown";
process.env.SENTRY_RELEASE = SENTRY_RELEASE;
process.env.NEXT_PUBLIC_SENTRY_RELEASE = SENTRY_RELEASE;

// Short commit shown in the version badge — derived from the same SHA as the
// release identifier so the badge and GlitchTip release can never disagree.
const gitCommit = SENTRY_RELEASE === "unknown" ? "unknown" : SENTRY_RELEASE.slice(0, 7);

// An unresolvable release on a production Railway build means events tag
// release=unknown and client stacks stop symbolicating (#2772). Warn loudly at
// build time — but don't fail the build; the deploy itself is still sound.
if (SENTRY_RELEASE === "unknown" && process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
  console.warn(
    '[next.config] SENTRY_RELEASE resolved to "unknown" on a production Railway build: ' +
      "RAILWAY_GIT_COMMIT_SHA is missing and `git rev-parse HEAD` failed. GlitchTip events " +
      "from this deploy will not symbolicate or attribute to a commit (#2772)."
  );
}

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// Railway injects RAILWAY_ENVIRONMENT_NAME on all deployments ("production", "staging", etc.).
// Show a "Preview" badge on any non-production Railway deployment.
const railwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME;
const isPreview = !!railwayEnv && railwayEnv !== "production";
const isProductionBuild = railwayEnv === "production";
const widenSentryClientFileUpload = process.env.SENTRY_WIDEN_CLIENT_FILE_UPLOAD === "true";
// Source-map upload is enabled only when an auth token is present, so local and
// token-less CI builds behave exactly as before (no upload, no failure). Set
// SENTRY_AUTH_TOKEN (a GlitchTip org token with project:releases scope) in the
// Railway build env to turn on symbolication — see docs/observability/sourcemaps.md.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
// Self-hosted GlitchTip base URL (the sentry-cli upload target). Defaults to the
// Sentry-compatible ingest for sourcemap upload; unset disables upload.
const sentryUrl = process.env.SENTRY_URL;

const nextConfig: NextConfig = {
  // Don't advertise the framework version via the x-powered-by header.
  poweredByHeader: false,
  // `output: "standalone"` was previously set for Vercel-era cold-start wins.
  // On Railway's long-running container, the standalone server.js does NOT
  // invoke instrumentation.ts's nodejs `register()` — only the edge runtime
  // gets it on first edge-route hit — so node-cron, auto-seed, and crash
  // capture never initialize. Running via `next start` (Nixpacks default
  // when no standalone output exists) restores correct instrumentation.
  // Railway containers are ephemeral — no previous .next to clean.
  // Setting false preserves the .next/cache nixpacks restores before each build,
  // enabling Turbopack incremental compilation across deploys.
  // Singleplayer builds DO want standalone output: it is what makes the shipped
  // bundle small, and the instrumentation it skips (node-cron, auto-seed) is
  // exactly what a local world must not run. Production stays on `next start`
  // for the reasons above.
  ...(process.env.SINGLEPLAYER === "1" ? { output: "standalone" as const } : {}),
  cleanDistDir: !railwayEnv,
  serverExternalPackages: ["mongodb"],
  allowedDevOrigins: ["127.0.0.1"],
  typescript: {
    tsconfigPath: isProductionBuild ? "tsconfig.build.json" : "tsconfig.json",
    // Type errors are caught by CI's tsc --noEmit step; removing this from
    // next build saves ~82s on the critical path without losing safety.
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_GIT_COMMIT: gitCommit,
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_IS_PREVIEW: isPreview ? "true" : "",
    SENTRY_RELEASE,
    NEXT_PUBLIC_SENTRY_RELEASE: SENTRY_RELEASE,
  },
  async headers() {
    return [
      {
        // Dynamic page documents and RSC payloads are private and must never be
        // shared by a CDN. Their bodies may be compressed at the origin, while
        // Cloudflare separately restricts edge encoding to gzip/Brotli for old
        // Android WebViews. API routes keep no-transform unless they explicitly
        // opt into another policy. Excludes /api and /_next. MUST stay first:
        // for a duplicate header key the LAST matching rule wins, so the
        // specific rules below override this blanket one.
        source: "/((?!api/|_next/).*)",
        headers: [
          {
            key: "Cache-Control",
            value: PRIVATE_PAGE_CACHE_CONTROL,
          },
        ],
      },
      {
        // A service-worker script must NEVER be HTTP-cached: the browser serves
        // the stale cached copy on its update check, so a changed sw.js (the
        // self-unregistering kill-switch that neutralises the old Monetag ad
        // worker — see public/sw.js / Bug #0795) can take up to the cache TTL to
        // reach an already-infected browser. Until then the old worker keeps
        // intercepting fetches and serving stale API/page responses, which reads
        // as "my data is out of date / nothing responds to actions". no-store
        // forces the kill-switch to land on the next load.
        // NOTE: if the CDN (Cloudflare) injects its own TTL on /sw.js, also add
        // an edge rule: /sw.js → Bypass Cache.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, no-transform" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        // Corp-detail and elections APIs return large JSON fetched client-side
        // after the page shell renders. They set no Cache-Control of their own,
        // so Cloudflare re-compresses them with zstd — whose Content-Encoding
        // some Android System WebView builds cannot decode, surfacing to the
        // client fetch() as a thrown "Network error" (works on desktop / newer
        // WebViews). `no-transform` makes Cloudflare fall back to Brotli/gzip,
        // which every WebView decodes. Scoped to these header-less trees on
        // purpose — a blanket /api/:path* rule could clash with the s-maxage
        // edge caching on public endpoints. Routes that build their own
        // Cache-Control already carry no-transform via the shared helpers
        // (withNoStore / conditionalJson / publicApi middleware).
        source: "/api/corporations/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, no-transform" }],
      },
      {
        source: "/api/elections/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, no-transform" }],
      },
      {
        // Banking hub/console GETs are per-user (your savings, your corp's
        // charter). Same cross-user leak class as the corporations rule.
        source: "/api/banking/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, no-transform" }],
      },
      {
        // Character creation (POST /api/auth/character) sets no Cache-Control
        // of its own, so the same zstd re-compression bug above hits the
        // "Ready to begin?" submit on affected Android WebViews: the response
        // never decodes, so the button spins forever with no error (report
        // 2026-07-16, AboSab).
        source: "/api/auth/character",
        headers: [{ key: "Cache-Control", value: "no-store, no-transform" }],
      },
      {
        source: "/country/:code/region/:id/party/:partyId",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate, no-transform",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN (not DENY) so same-origin pages can embed each other in
          // iframes — the Political Operations dashboard frames the same-origin
          // /campaign/[id] page in its Campaign Manager tab. DENY blocks ALL
          // framing including same-origin, which rendered that iframe as the
          // browser's "refused to connect" placeholder. Cross-origin framing
          // (the actual clickjacking vector) is still blocked.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Report-only CSP: collect violations and tune before switching to an
          // enforcing Content-Security-Policy. object-src/base-uri are already
          // locked down; script/connect/frame are permissive for AdSense + YouTube.
          // fundingchoicesmessages.google.com serves the GDPR/EU consent dialog
          // (Google Funding Choices) and must be allowlisted or the message
          // silently fails to render once this policy goes enforcing.
          // worker-src blob: was added for the (now-removed) OpenReplay worker; retained pending a blob-worker audit.
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: blob: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://*.googlesyndication.com https://www.googletagmanager.com https://fundingchoicesmessages.google.com; worker-src 'self' blob:; connect-src 'self' https:; frame-src 'self' https://www.youtube.com https://*.googlesyndication.com https://googleads.g.doubleclick.net https://fundingchoicesmessages.google.com",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        // The in-app API reference page was retired in favor of the canonical
        // docs site (docs.lakesidegames.net, source: Egg3901/ahd-docs). Keeping
        // a permanent redirect so bookmarks and the old sitemap entry resolve.
        source: "/api-guide",
        destination: "https://docs.lakesidegames.net/api/public-v1.html",
        permanent: true,
      },
      {
        source: "/uk",
        destination: "/country/uk",
        permanent: true,
      },
      {
        source: "/congress",
        destination: "/country/us/legislature",
        permanent: true,
      },
      {
        source: "/legislature/:code",
        destination: "/country/:code/legislature",
        permanent: true,
      },
      {
        source: "/legislature/:code/:chamber",
        destination: "/country/:code/legislature",
        permanent: true,
      },
      {
        source: "/executive/:code",
        destination: "/country/:code/executive",
        permanent: true,
      },
      {
        source: "/executive/:code/cabinet",
        destination: "/country/:code/executive/cabinet",
        permanent: true,
      },
      {
        source: "/uk/elections",
        destination: "/country/uk/elections",
        permanent: true,
      },
      {
        source: "/uk/government",
        destination: "/country/uk/executive",
        permanent: true,
      },
      {
        source: "/uk/map",
        destination: "/country/uk/map",
        permanent: true,
      },
      {
        source: "/whitehouse",
        destination: "/country/us/executive",
        permanent: true,
      },
      {
        source: "/whitehouse/cabinet",
        destination: "/country/us/executive/cabinet",
        permanent: true,
      },
      {
        source: "/central-bank/:code",
        destination: "/country/:code/central-bank",
        permanent: true,
      },
      {
        source: "/stockmarket/us",
        destination: "/country/us/stockmarket",
        permanent: true,
      },
      {
        source: "/stockmarket/uk",
        destination: "/country/uk/stockmarket",
        permanent: true,
      },
      {
        source: "/national",
        destination: "/country/us/metrics",
        permanent: true,
      },
      {
        source: "/cookies",
        destination: "/privacy#cookies",
        permanent: true,
      },
      {
        // Old multi-tab (countries/players/corporations) leaderboard removed —
        // superseded by the Hall of Fame's cross-iteration Legacy Score, which
        // now also covers "who's leading right now" via ?scope=current.
        source: "/world/leaderboard",
        destination: "/world/legacy",
        permanent: true,
      },
    ];
  },
  images: {
    localPatterns: [
      {
        pathname: "/**",
      },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "flagcdn.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
};

// Locale resolution lives in src/i18n/request.ts (cookie-based, no URL
// prefix), so the plugin only wires the request config into the build.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(
  withSentryConfig(nextConfig, {
    org: "ahousedivided",
    // GlitchTip project slug is "ahd" (not "a-house-divided"); artifacts must be
    // uploaded to the real slug or symbolication silently no-ops.
    project: "ahd",
    sentryUrl,
    authToken: sentryAuthToken,
    // Tie uploaded source-map artifacts to the same release the runtime tags
    // events with, so client stacks symbolicate against the right bundle.
    release: { name: SENTRY_RELEASE },
    silent: !process.env.CI,
    widenClientFileUpload: widenSentryClientFileUpload,
    // GlitchTip 6.1 implements the artifact-bundle / chunk-upload API, so source
    // maps DO symbolicate client stacks (turning minified `rX`/`ux` frames into
    // real file:line). Upload is gated on the auth token so token-less builds are
    // unaffected. Maps are uploaded then deleted from the build output by the
    // plugin, so they are never served publicly.
    sourcemaps: {
      disable: !sentryAuthToken,
    },
    webpack: {
      automaticVercelMonitors: false,
      treeshake: {
        removeDebugLogging: true,
      },
    },
  })
);
