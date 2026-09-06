import type { Metadata } from "next";
import { Geist, Geist_Mono, Lora, Fraunces, JetBrains_Mono } from "next/font/google";
import { redirect } from "next/navigation";
import Script from "next/script";
import { cookies, headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { NavbarWrapper } from "@/components/NavbarWrapper";
import { BugReportFab } from "@/components/BugReportFab";
import { StatusBar } from "@/components/StatusBar";
import { TurnProgressToast } from "@/components/turn-progress/TurnProgressToast";
import { TutorialCoachMount } from "@/components/tutorial/TutorialCoachMount";
import { FeedbackProvider } from "@/contexts/FeedbackContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { BrowserPreferencesProvider } from "@/contexts/BrowserPreferencesContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { CharacterStatsProvider } from "@/contexts/CharacterStatsContext";
import { AuthDataProvider } from "@/contexts/AuthDataContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { RegisteredCountriesProvider } from "@/contexts/RegisteredCountriesContext";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { loadCountryNameOverrides } from "@/lib/country/countryIdentity";
import { getGameState } from "@/lib/gameState";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { LiveRefreshBanner } from "@/components/LiveRefreshBanner";
import { MassCrashAlertBanner } from "@/components/MassCrashAlertBanner";
import { MaintenancePartialBanner } from "@/components/MaintenancePartialBanner";
import { PollBannerNotice } from "@/components/PollBannerNotice";
import { Analytics } from "@vercel/analytics/next";
import { isSingleplayer } from "@/lib/singleplayer";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AdSlot } from "@/components/AdSlot";
import { AdSenseSlot } from "@/components/AdSenseSlot";
import { CookieConsentBanner } from "@/components/CookieConsent";
import { SiteFooter } from "@/components/SiteFooter";
import { AuthConnectivityGate } from "@/components/AuthConnectivityGate";
import { StatAllocationGate } from "@/components/stats/StatAllocationGate";
import { SeasonRecapGate } from "@/components/recap/SeasonRecapGate";
import { SiteTrafficTracker } from "@/components/SiteTrafficTracker";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import {
  buildGoogleTagBootstrapScript,
  getAdSenseClientId,
  getAdSensePageTagUrl,
  shouldRenderConsentManagedGoogleTags,
  shouldRenderGooglePrivacyMessaging,
} from "@/lib/googlePrivacyMessaging";
import {
  DEFAULT_SITE_DESCRIPTION,
  SITE_BRAND,
  SITE_SUBTITLE,
  getSiteUrl,
} from "@/lib/siteMetadata";
import { verifyAuth } from "@/lib/auth";
import { getCachedMaintenanceStatus, isMaintenanceBypassPath } from "@/lib/maintenanceStatus";
import { resolveNavbarPageCountry } from "@/lib/navigation/resolveNavbarPageCountry";
import "./globals.css";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

// Font preloading is deliberately limited to the two families that render
// above the fold on a cold anonymous load: Geist Sans (body copy, and the
// landing page's LCP element) and Lora (the global `h1` rule in globals.css).
//
// All five families used to emit `<link rel=preload>`, so 166KB of woff2
// across 5 files started at ~200ms and fought for the same connection. On a
// throttled mid-tier mobile profile (4x CPU, 1.6Mbps) they did not finish
// until 2326-3342ms, and the landing LCP fired at 2940ms — the paragraph was
// waiting on its own font swap. Perf audit 2026-07-26.
//
// The three below still load normally when a glyph needs them; they just no
// longer compete during first paint. `display: "swap"` keeps their text
// visible in the fallback face meanwhile, and next/font's automatic
// size-adjust fallback keeps the swap from shifting layout.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

// The Blend election/campaign screens set standfirsts and rail subtitles in
// italic Lora, so the italic face is loaded rather than left to the browser's
// synthetic oblique.
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

// Used by the 1953 CRT command theme (globals.css) and by the Blend campaign /
// election screens, which set every numeric and label in it. Neither is the
// default landing surface, so it stays out of the preload set.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const siteUrl = getSiteUrl();
const defaultDocumentTitle = `${SITE_BRAND} | ${SITE_SUBTITLE}`;
const GA_MEASUREMENT_ID = "G-5GBG3BHWCZ";
const GOOGLE_ADS_ID = "AW-18130975758";

export const metadata: Metadata = {
  title: defaultDocumentTitle,
  // Icons are automatically picked up from icon.png and apple-icon.png in app directory
  description: DEFAULT_SITE_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: defaultDocumentTitle,
    description: DEFAULT_SITE_DESCRIPTION,
    type: "website",
    siteName: SITE_BRAND,
    url: siteUrl,
    locale: "en_US",
    images: [
      {
        url: CDN_LOGO_URL,
        width: 256,
        height: 256,
        alt: SITE_BRAND,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: defaultDocumentTitle,
    description: DEFAULT_SITE_DESCRIPTION,
    images: [CDN_LOGO_URL],
  },
  keywords:
    "political simulation game, economic simulation, multiplayer elections, congress, parliament, campaigns, corporations, forex, US politics, UK politics, Soviet Union politics, East Germany politics",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_BRAND,
  description: DEFAULT_SITE_DESCRIPTION,
  applicationCategory: "Game",
  operatingSystem: "Web",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [cookieStore, requestHeaders, locale, intlMessages, t] = await Promise.all([
    cookies(),
    headers(),
    getLocale(),
    getMessages(),
    getTranslations("layout"),
  ]);
  const userAgent = requestHeaders.get("user-agent") ?? "";
  const isNativeApp = userAgent.includes("AHD-Android");
  const host = requestHeaders.get("host");
  const pathname = requestHeaders.get("x-pathname") ?? "/";
  const displayMode = cookieStore.get("ahd-display-mode")?.value as
    "focused" | "classic" | undefined;

  // Runtime country sets hydrated into the client tree via RegisteredCountriesProvider:
  //  - `registered` (COUNTRY_ORDER ∪ activated latent countries, e.g. a seceded SCO/WAL) for
  //    admin tooling, which manages every country that exists.
  //  - `enabled` (the player-live subset) for the player-facing nation switcher, so a
  //    registered-but-not-yet-enabled country stays hidden until activation flips it on.
  // The root layout must never crash on a DB hiccup — fall back to the static base.
  let registeredCountries: CountryId[] = COUNTRY_ORDER;
  let enabledCountries: CountryId[] = COUNTRY_ORDER;
  let activePreset = "2019-default";
  // Runtime renames, so client surfaces stop naming a country by its compiled
  // seed name after something has renamed it — a reunified Germany read as
  // "East Germany" in every client-rendered navbar and card while the
  // server-rendered pages called it Germany.
  let countryNameOverrides: Partial<Record<CountryId, string>> = {};
  try {
    const db = await getDb();
    const [registered, enabled, gameState, nameOverrides] = await Promise.all([
      getRegisteredCountryIds(db),
      getEnabledCountryIds(),
      getGameState(),
      loadCountryNameOverrides(db),
    ]);
    registeredCountries = registered;
    enabledCountries = enabled;
    activePreset = gameState?.preset ?? DEFAULT_SEED_PRESET;
    countryNameOverrides = nameOverrides;
  } catch {
    // keep the COUNTRY_ORDER + 2019-default + no-override fallback
  }
  if (!isMaintenanceBypassPath(pathname)) {
    // Fail-open if the maintenance lookup throws. The proxy is the primary
    // gate; this layout-level check is defense in depth, so a transient DB
    // blip here should render the page rather than 500 the whole layout.
    //
    // Only "full" redirects every page — "partial" leaves pages reachable.
    let maintenanceMode: "off" | "partial" | "full" = "off";
    try {
      const maintenance = await getCachedMaintenanceStatus();
      maintenanceMode = maintenance.mode;
    } catch (err) {
      console.warn("[layout] maintenance lookup failed; rendering page", err);
    }
    if (maintenanceMode === "full") {
      // verifyAuth now propagates non-JOSE errors so transient throws don't
      // silently log users out elsewhere. Here we fail closed — any failure
      // to confirm admin during maintenance mode redirects to /maintenance.
      let authPayload: Awaited<ReturnType<typeof verifyAuth>> = null;
      try {
        authPayload = await verifyAuth();
      } catch (err) {
        console.warn("[layout] verifyAuth threw during maintenance check", err);
      }
      if (authPayload?.isAdmin !== true) {
        redirect("/maintenance");
      }
    }
  }

  const isWikiSubdomain =
    host === "wiki.ahousedividedgame.com" || (host?.startsWith("wiki.") ?? false);

  const initialPageCountry = await resolveNavbarPageCountry({
    pathname,
    search: requestHeaders.get("x-search"),
  });
  const adSenseClientId = getAdSenseClientId();
  // Never load the AdSense page tag (auto ads + CMP) inside the native app
  // WebView: AdSense is not permitted in app WebViews, and its third-party
  // requests are routinely killed by mobile DNS filters / adblockers, which
  // the Android shell used to misread as the server being unreachable.
  // The page tag enables Google Auto ads. Loading it on a game, account, or
  // community screen can result in Google-served ads on a non-editorial page,
  // even when no manual AdSense component is mounted there.
  const renderGoogleCmp = shouldRenderGooglePrivacyMessaging(pathname, host) && !isNativeApp;
  // Server component, so this is a plain call. Throws on a deployment
  // that sets SINGLEPLAYER, by design: see @/lib/singleplayer.
  const singleplayer = isSingleplayer();
  const renderConsentManagedGoogleTags = shouldRenderConsentManagedGoogleTags(pathname);
  const googleTagBootstrap = buildGoogleTagBootstrapScript(
    GA_MEASUREMENT_ID,
    renderGoogleCmp ? "cmp" : "fallback"
  );

  return (
    <html lang={locale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} ${fraunces.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <Script
          id="ld-json"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Script
          id="display-mode"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `window.__AHD_DISPLAY_MODE=${JSON.stringify(displayMode ?? null)};`,
          }}
        />
        {renderGoogleCmp ? (
          <>
            <Script
              id="google-privacy-messaging-bootstrap"
              strategy="beforeInteractive"
              dangerouslySetInnerHTML={{
                __html:
                  "window.googlefc = window.googlefc || {}; window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];",
              }}
            />
            {/*
              afterInteractive, not beforeInteractive: the AdSense page tag is
              ~56KB and pulls in show_ads_impl (~186KB more), and as a
              beforeInteractive script it ran ahead of hydration on every page.
              Measured on the landing page (4x CPU, 1.6Mbps), blocking Google
              ad+analytics traffic cut Total Blocking Time from 2398ms to
              1483ms and JS heap from 24MB to 12.7MB. Perf audit 2026-07-26.

              The googlefc consent bootstrap above stays beforeInteractive so
              the CMP callback queue still exists before any consent callback
              can fire; only the tag fetch is deferred, which matches Google's
              own async-loading guidance.
            */}
            <Script
              src={getAdSensePageTagUrl(adSenseClientId!)}
              strategy="afterInteractive"
              crossOrigin="anonymous"
            />
          </>
        ) : null}
        <a
          href="#main-content"
          className="absolute -top-24 left-4 z-[200] rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white outline-none transition-[top] duration-150 focus:top-4 focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
        >
          {t("skipToMainContent")}
        </a>
        <NextIntlClientProvider locale={locale} messages={intlMessages}>
          <RegisteredCountriesProvider
            value={{
              registered: registeredCountries,
              enabled: enabledCountries,
              preset: activePreset,
              nameOverrides: countryNameOverrides,
            }}
          >
            <AuthDataProvider>
              <CurrencyProvider>
                <ThemeProvider>
                  <BrowserPreferencesProvider>
                    <FeedbackProvider>
                      <ToastProvider>
                        <CharacterStatsProvider>
                          {!isWikiSubdomain && (
                            <NavbarWrapper
                              displayMode={displayMode}
                              initialPageCountry={initialPageCountry}
                            />
                          )}
                          {!isWikiSubdomain && <BugReportFab displayMode={displayMode} />}
                          {!isWikiSubdomain && <MassCrashAlertBanner />}
                          {!isWikiSubdomain && <MaintenancePartialBanner />}
                          {/* Admin-controlled survey strip. Not auth-gated: it must reach
                            signed-out visitors too. */}
                          {!isWikiSubdomain && <PollBannerNotice />}
                          <AuthConnectivityGate />
                          <StatAllocationGate />
                          <SeasonRecapGate />
                          {/* overflow-x-CLIP, not -hidden: hidden makes this element the
                            scroll container for every `position: sticky` descendant
                            (admin status bar / sidebars / table headers), which both
                            displaces them by their `top` offset at rest and prevents
                            them from ever sticking to the viewport. clip gives the same
                            horizontal clipping without creating a scroll container. */}
                          <main
                            id="main-content"
                            className="min-w-0 overflow-x-clip pb-14"
                            tabIndex={-1}
                          >
                            <SiteTrafficTracker />
                            {children}
                          </main>
                          {!isWikiSubdomain && !isNativeApp && <AdSlot />}
                          {!isWikiSubdomain && !isNativeApp && <AdSenseSlot />}
                          {!isWikiSubdomain && <SiteFooter displayMode={displayMode} />}
                          {!isWikiSubdomain && <StatusBar />}
                          {!isWikiSubdomain && <TurnProgressToast />}
                          {!isWikiSubdomain && <TutorialCoachMount />}
                          {!isWikiSubdomain && <LiveRefreshBanner />}
                          {!isNativeApp && <CookieConsentBanner />}
                          {/* A singleplayer build runs on the player's machine with no
                              account and nothing to measure. None of the telemetry or
                              ad tags below have a job there, and the Vercel ones are
                              dead even in production. */}
                          {!singleplayer && (
                            <>
                              {renderConsentManagedGoogleTags ? (
                                <>
                                  <Script
                                    src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
                                    strategy="afterInteractive"
                                  />
                                  <Script
                                    id="google-analytics"
                                    strategy="afterInteractive"
                                    dangerouslySetInnerHTML={{
                                      __html: googleTagBootstrap,
                                    }}
                                  />
                                  <Script
                                    id="google-ads"
                                    strategy="afterInteractive"
                                    dangerouslySetInnerHTML={{
                                      __html: `gtag('config', '${GOOGLE_ADS_ID}');`,
                                    }}
                                  />
                                </>
                              ) : null}
                              <Script
                                id="umami-analytics"
                                src="https://analytics.ahousedividedgame.com/script.js"
                                data-website-id="caa223b2-469d-4325-9ad3-63e3e87ed3d1"
                                strategy="afterInteractive"
                              />
                              <Analytics />
                              <SpeedInsights />
                            </>
                          )}
                        </CharacterStatsProvider>
                      </ToastProvider>
                    </FeedbackProvider>
                  </BrowserPreferencesProvider>
                </ThemeProvider>
              </CurrencyProvider>
            </AuthDataProvider>
          </RegisteredCountriesProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
