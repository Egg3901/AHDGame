"use client";

import { Suspense, useState, useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useUserData } from "@/hooks/useUserData";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  ChevronDown,
  Database,
  Gamepad2,
  MonitorCog,
  Search,
  ShieldCheck,
  Volume2,
  X,
} from "lucide-react";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";
import { ProfileHeaderImageUpload } from "@/components/ProfileHeaderImageUpload";
import { SettingsAchievementsSection } from "@/components/SettingsAchievementsSection";
import { PatreonBenefitsSection } from "@/components/settings/PatreonBenefitsSection";
import { RetiredCharactersSection } from "@/components/settings/RetiredCharactersSection";
import { CharacterDangerZone } from "@/components/settings/CharacterDangerZone";

import { type SectionId, SectionIcon, MessageBanner } from "./components/shared";
import { ProfileSection } from "./components/ProfileSection";
import { IdentitySection } from "./components/IdentitySection";
import { DemographicsSection } from "./components/DemographicsSection";
import { CampaignSongSection } from "./components/CampaignSongSection";
import { PoliticsSection } from "./components/PoliticsSection";
import { AppearanceSection } from "./components/AppearanceSection";
import { SecuritySection } from "./components/SecuritySection";
import { DangerZoneSection } from "./components/DangerZoneSection";
import { ReferralsSection } from "./components/ReferralsSection";
import { SupporterPerksSection } from "./components/SupporterPerksSection";
import { ApiKeysSection } from "./components/ApiKeysSection";

import {
  type CharacterData,
  type CorporationData,
  type OAuthData,
  type Recommendation,
  ALL_SECTIONS,
  CHARACTER_SECTIONS,
  DISCORD_MESSAGES,
  GOOGLE_MESSAGES,
  IMPERIAL_SECTIONS,
} from "./components/sectionsConfig";
import { RecommendationsBlurb } from "./components/RecommendationsBlurb";
import {
  ADVANCED_SECTION_IDS,
  CONTROL_PANEL_BUCKETS,
  bucketForSection,
  bucketQuickSettingsMatch,
  sectionMatchesQuery,
  type SettingsBucketId,
} from "./components/controlPanelConfig";
import {
  AudioQuickSettings,
  DataQuickSettings,
  GameQuickSettings,
  InterfaceQuickSettings,
} from "./components/QuickSettingsPanels";

export function SettingsPageContent() {
  const t = useTranslations("settings");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userData, rawUser, hasCharacter, loading, refetch } = useUserData();
  const { refetch: refetchNav } = useAuthMe();
  const { theme } = useTheme();
  // Guards against a false "signed out" redirect when the user lands on /settings
  // via client-side navigation from /profile. The shared AuthDataContext can
  // briefly have stale/null user state if its initial /api/auth/me fetch lost
  // the race with a cold Vercel function; we refetch once before redirecting.
  // Ref instead of state: we don't want the retry attempt to trigger a rerender,
  // just to gate the effect body.
  const authRetryAttemptedRef = useRef(false);
  const characterSyncAttemptedRef = useRef(false);
  const deepLinkScrolledRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [oauthBannerDismissed, setOauthBannerDismissed] = useState(false);
  const discord = searchParams.get("discord");
  const google = searchParams.get("google");
  const reason = searchParams.get("reason");
  const hasDiscordParams = discord === "linked" || (discord === "error" && reason);
  const hasGoogleParams = google === "linked" || (google === "error" && reason);
  const oauthBanner = (() => {
    if (oauthBannerDismissed) return null;
    if (hasDiscordParams) {
      return discord === "linked"
        ? DISCORD_MESSAGES.linked
        : (DISCORD_MESSAGES[reason ?? ""] ?? { key: "oauth.discord.failed", ok: false });
    }
    if (hasGoogleParams) {
      return google === "linked"
        ? GOOGLE_MESSAGES.linked
        : (GOOGLE_MESSAGES[reason ?? ""] ?? { key: "oauth.google.failed", ok: false });
    }
    return null;
  })();

  const [character, setCharacter] = useState<CharacterData | null>(null);
  const [corporation, setCorporation] = useState<CorporationData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  // `?section=<id>` deep-links straight to a panel — used by the /maintenance
  // page to point a between-iterations player at their character history so
  // they can re-watch an older character's Wrapped. Unknown ids fall back to
  // the section index rather than rendering an empty panel.
  const [activeSection, setActiveSection] = useState<SectionId | null>(() => {
    const requested = searchParams.get("section");
    return requested && ALL_SECTIONS.some((s) => s.id === requested)
      ? (requested as SectionId)
      : null;
  });
  const [disableAutoplayOnOtherProfiles, setDisableAutoplayOnOtherProfiles] = useState(false);
  const [enableExperimentalUI, setEnableExperimentalUI] = useState(true);
  const [referralCount, setReferralCount] = useState(0);
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [hasPassword, setHasPassword] = useState(true);
  const [oauthData, setOauthData] = useState<OAuthData>({});

  // Imperial character state — derived from auth/me response
  const isImperial = !!rawUser?.isImperial;
  const hasImperialCharacter = !!rawUser?.imperialCharacter;
  const activeRegularCharacterId = rawUser?.character?.id as string | undefined;
  const imperialChar = rawUser?.imperialCharacter as
    | { id: string; name: string; royalHouse: string; countryId: string; sequentialId: number }
    | undefined;

  const handleSwitchCharacterType = async () => {
    const newType = isImperial ? "character" : "imperial";
    try {
      const res = await fetch("/api/imperial-characters/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: newType }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      /* ignore */
    }
  };

  const selectSection = (id: SectionId) => {
    setActiveSection(id);
    requestAnimationFrame(() => {
      document.getElementById(`${id}-panel`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  const goToOverview = () => {
    setActiveSection(null);
  };

  useEffect(() => {
    if (loading || userData) return;
    // Retry the auth fetch once before giving up — the shared AuthDataContext
    // only fetches /api/auth/me on mount, so a transient 401/5xx on initial page
    // load leaves us with a stale "logged out" snapshot even when the cookie is
    // valid. Re-fetching here fixes the profile→settings sign-out flash.
    if (!authRetryAttemptedRef.current) {
      authRetryAttemptedRef.current = true;
      void refetch();
    }
    // After the retry, wait for the context to update. If the user is still
    // null after 800ms the cookie really is gone and we redirect to /login,
    // preserving a returnUrl so the user lands back on /settings after signing
    // in again.
    const timer = setTimeout(() => {
      const returnUrl = encodeURIComponent("/settings");
      router.push(`/login?returnUrl=${returnUrl}`);
    }, 800);
    return () => clearTimeout(timer);
  }, [loading, userData, router, refetch]);

  useLayoutEffect(() => {
    if (loading) return;

    if (!userData) return;

    // The shared auth context is fetched once at app boot and can be stale after
    // a character was created/switched elsewhere. Revalidate once on /settings so
    // we don't render the empty-character state from an old snapshot.
    if (!hasCharacter && !characterSyncAttemptedRef.current) {
      characterSyncAttemptedRef.current = true;
      void refetch();
    }
  }, [loading, userData, hasCharacter, refetch]);

  // Auto-dismiss OAuth banner and clear URL after 6s
  useEffect(() => {
    const discord = searchParams.get("discord");
    const google = searchParams.get("google");
    const reason = searchParams.get("reason");
    if (
      discord === "linked" ||
      (discord === "error" && reason) ||
      google === "linked" ||
      (google === "error" && reason)
    ) {
      const t = setTimeout(() => {
        setOauthBannerDismissed(true);
        router.replace("/settings", { scroll: false });
      }, 6000);
      return () => clearTimeout(t);
    }
  }, [searchParams, router]);

  // Populate account fields from rawUser (already fetched by useUserData — no extra round-trip).
  // One-time sync from server data to local state; these fields may be mutated by user actions later.
  useEffect(() => {
    if (!rawUser) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time initialisation from already-fetched server data
    setDisableAutoplayOnOtherProfiles(rawUser.disableAutoplayOnOtherProfiles ?? false);
    setEnableExperimentalUI(rawUser.enableExperimentalUI !== false);
    setReferralCount(rawUser.referralCount ?? 0);
    setUserId(rawUser.id ?? "");
    setUsername(rawUser.username ?? "");
    setEmail(rawUser.email ?? "");
    setHasPassword(rawUser.hasPassword ?? true);

    setOauthData({
      discordId: rawUser.discordId,
      discordUsername: rawUser.discordUsername,
      discordAvatar: rawUser.discordAvatar,
      googleId: rawUser.googleId,
      googleEmail: rawUser.googleEmail,
      googleName: rawUser.googleName,
      googleAvatar: rawUser.googleAvatar,
    });
  }, [rawUser]);

  useEffect(() => {
    if (loading) return;

    if (isImperial || !activeRegularCharacterId) return;

    const controller = new AbortController();
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting a fresh load for the active regular character
    setDataLoading(true);

    Promise.all([
      fetch("/api/auth/character", { signal: controller.signal }),
      fetch("/api/character/me", { signal: controller.signal }),
    ])
      .then(async ([charRes, meRes]) => {
        const c = await charRes.json();
        const me = meRes.ok ? await meRes.json() : null;
        if (cancelled) return;
        if (!charRes.ok || !c || typeof c !== "object" || "error" in c || !("_id" in c)) {
          setCharacter(null);
        } else {
          // Merge OAuth data from rawUser into character
          if (rawUser) {
            c.discordId = rawUser.discordId;
            c.discordUsername = rawUser.discordUsername;
            c.discordAvatar = rawUser.discordAvatar;
            c.googleId = rawUser.googleId;
            c.googleEmail = rawUser.googleEmail;
            c.googleName = rawUser.googleName;
            c.googleAvatar = rawUser.googleAvatar;
          }
          setCharacter(c);
        }
        setCorporation(
          me && typeof me === "object" && me.corporation && typeof me.corporation === "object"
            ? me.corporation
            : null
        );
      })
      .catch(() => {
        if (!cancelled) {
          setCharacter(null);
          setCorporation(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDataLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loading, isImperial, activeRegularCharacterId, rawUser]);

  const handleAutoplayPreference = async (value: boolean) => {
    setDisableAutoplayOnOtherProfiles(value);
    try {
      await fetch("/api/settings/autoplay-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disableAutoplayOnOtherProfiles: value }),
      });
    } catch {
      // Silently fail
    }
  };

  const handleExperimentalUiPreference = async (value: boolean) => {
    setEnableExperimentalUI(value);
    try {
      await fetch("/api/settings/experimental-ui", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableExperimentalUI: value }),
      });
      // Refresh the nav bootstrap so NavbarWrapper switches navbars without a reload.
      refetchNav();
    } catch {
      // Silently fail
    }
  };

  const handleReelectionPreference = async (value: boolean) => {
    setCharacter((c) => (c ? { ...c, autoRunForReelection: value } : null));
    try {
      await fetch("/api/settings/reelection-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRunForReelection: value }),
      });
    } catch {
      // Silently fail
    }
  };

  const effectiveCharacter =
    !isImperial && activeRegularCharacterId && character?._id === activeRegularCharacterId
      ? character
      : null;
  const showImperialSettings = isImperial && hasImperialCharacter;
  const hasVisibleCharacterSettings = showImperialSettings || !!effectiveCharacter;
  // dataLoading only matters while resolving the active regular character.
  const isLoading = loading || (!isImperial && !!activeRegularCharacterId && dataLoading);

  useEffect(() => {
    if (isLoading || !activeSection || deepLinkScrolledRef.current) return;
    deepLinkScrolledRef.current = true;
    requestAnimationFrame(() => {
      const bucket = bucketForSection(activeSection);
      document.getElementById(`${activeSection}-panel`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      if (!document.getElementById(`${activeSection}-panel`) && bucket) {
        document.getElementById(`settings-${bucket.id}`)?.scrollIntoView({ block: "start" });
      }
    });
  }, [activeSection, isLoading]);

  const onCharacterUpdate = (u: Partial<CharacterData>) =>
    setCharacter((c) => (c ? { ...c, ...u } : null));

  const onOauthUpdate = (u: Partial<OAuthData>) => {
    setOauthData((prev) => ({ ...prev, ...u }));
    // Also update character if it exists
    setCharacter((c) => (c ? { ...c, ...u } : null));
  };

  // Build contextual recommendations for the hero blurb (max 3)
  const recommendations: Recommendation[] = (() => {
    const list: Recommendation[] = [];
    if (effectiveCharacter && !effectiveCharacter.avatarUrl) {
      list.push({
        id: "pfp",
        icon: (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        ),
        label: t("recommendations.setProfilePicture"),
        action: "section",
        sectionId: "profile",
      });
    }
    if (effectiveCharacter && !effectiveCharacter.profileHeaderImageUrl) {
      list.push({
        id: "header",
        icon: (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        ),
        label: t("recommendations.setProfileHeader"),
        action: "section",
        sectionId: "profile",
      });
    }
    if (theme === "default") {
      list.push({
        id: "theme",
        icon: (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
        ),
        label: t("recommendations.chooseTheme"),
        action: "section",
        sectionId: "appearance",
      });
    }
    if (effectiveCharacter && !effectiveCharacter.discordId) {
      list.push({
        id: "discord",
        icon: (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
        ),
        label: t("recommendations.linkDiscord"),
        action: "link",
        href: "/api/auth/discord",
      });
    }
    if (corporation && !corporation.logoUrl) {
      list.push({
        id: "corp-logo",
        icon: (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5"
            />
          </svg>
        ),
        label: t("recommendations.setCorpLogo", { name: corporation.name }),
        action: "link",
        href: `/corporation/${corporation.sequentialId}`,
      });
    }
    list.push({
      id: "changelog",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      label: t("recommendations.viewChangelog"),
      action: "link",
      href: "/changelog",
    });
    return list.slice(0, 3);
  })();

  // Render a section's content by id
  function renderSectionContent(id: SectionId) {
    switch (id) {
      case "account-profile":
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {t("page.username")}
              </label>
              <div className="rounded-xl border border-card-border bg-background/50 px-4 py-2.5 text-sm text-foreground">
                {username || "..."}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">{t("page.email")}</label>
              <div className="rounded-xl border border-card-border bg-background/50 px-4 py-2.5 text-sm text-foreground">
                {email || t("common.notSet")}
              </div>
            </div>
            <p className="text-xs text-muted">{t("page.contactAdmin")}</p>
          </div>
        );
      case "identity":
        return <IdentitySection character={oauthData} onCharacterUpdate={onOauthUpdate} />;
      case "appearance":
        return (
          <AppearanceSection
            disableAutoplayOnOtherProfiles={disableAutoplayOnOtherProfiles}
            onAutoplayChange={handleAutoplayPreference}
            enableExperimentalUI={enableExperimentalUI}
            onExperimentalUiChange={handleExperimentalUiPreference}
          />
        );
      case "patreon":
        return <PatreonBenefitsSection />;
      case "supporter-perks":
        return <SupporterPerksSection />;
      case "referrals":
        return <ReferralsSection userId={userId} referralCount={referralCount} />;
      case "achievements":
        return <SettingsAchievementsSection characterId={effectiveCharacter?._id} />;
      case "retired-characters":
        return <RetiredCharactersSection />;
      case "security":
        return (
          <SecuritySection hasPassword={hasPassword} onPasswordSet={() => setHasPassword(true)} />
        );
      case "danger":
        return <DangerZoneSection onAccountDeleted={() => router.push("/")} />;
      case "api-keys":
        return <ApiKeysSection />;
      case "profile":
        return effectiveCharacter ? (
          <ProfileSection
            character={effectiveCharacter}
            onCharacterUpdate={onCharacterUpdate}
            profileHref={buildCharacterHref(effectiveCharacter)}
          />
        ) : null;
      case "demographics":
        return effectiveCharacter ? (
          <DemographicsSection
            character={effectiveCharacter}
            onCharacterUpdate={onCharacterUpdate}
          />
        ) : null;
      case "politics":
        return effectiveCharacter ? (
          <PoliticsSection
            character={effectiveCharacter}
            onCharacterUpdate={onCharacterUpdate}
            onReelectionChange={handleReelectionPreference}
          />
        ) : null;
      case "campaign-song":
        return effectiveCharacter ? (
          <CampaignSongSection
            character={effectiveCharacter}
            onCharacterUpdate={onCharacterUpdate}
          />
        ) : null;
      case "character-danger":
        return effectiveCharacter ? (
          <CharacterDangerZone characterName={effectiveCharacter.name} />
        ) : null;
      case "imperial-profile":
        return imperialChar ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">{t("page.name")}</label>
              <div className="rounded-xl border border-card-border bg-background/50 px-4 py-2.5 text-sm text-foreground">
                {imperialChar.name}
              </div>
              <p className="mt-1 text-xs text-muted">{t("page.imperialContactAdmin")}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {t("page.avatar")}
              </label>
              <ProfilePictureUpload
                size="compact"
                currentUrl={rawUser?.imperialCharacter?.avatarUrl}
                characterName={imperialChar.name}
                patreonTier={rawUser?.patreonTier ?? null}
                patreonExpiresAt={rawUser?.patreonExpiresAt ?? null}
                isAdmin={userData?.isAdmin}
                onSuccess={() => window.location.reload()}
              />
            </div>
          </div>
        ) : null;
      case "royal-identity":
        return imperialChar ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {t("page.royalHouse")}
              </label>
              <div className="rounded-xl border border-card-border bg-background/50 px-4 py-2.5 text-sm text-foreground">
                {imperialChar.royalHouse}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {t("page.coatOfArms")}
              </label>
              <p className="text-xs text-muted mb-2">{t("page.coatOfArmsHint")}</p>
              <ProfilePictureUpload
                size="compact"
                currentUrl={rawUser?.imperialCharacter?.coatOfArmsUrl}
                characterName="Coat of Arms"
                patreonTier={rawUser?.patreonTier ?? null}
                patreonExpiresAt={rawUser?.patreonExpiresAt ?? null}
                isAdmin={userData?.isAdmin}
                uploadUrl="/api/upload/coat-of-arms"
                onSuccess={() => window.location.reload()}
              />
            </div>
          </div>
        ) : null;
      case "royal-anthem":
        return imperialChar ? (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              {t.rich("page.royalAnthemHint", {
                link: (chunks) => (
                  <Link
                    href={`/imperial/${imperialChar.sequentialId}`}
                    className="text-primary hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        ) : null;
      default:
        return null;
    }
  }

  const visibleCharacterSections = new Set(
    (isImperial ? IMPERIAL_SECTIONS : effectiveCharacter ? CHARACTER_SECTIONS : []).map(
      (section) => section.id
    )
  );
  const availableSections = ALL_SECTIONS.filter(
    (section) => section.group === "account" || visibleCharacterSections.has(section.id)
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const activeDefinition = activeSection
    ? availableSections.find((section) => section.id === activeSection)
    : null;
  const playerCountries = [
    ...new Set(
      [
        rawUser?.character?.countryId as string | undefined,
        rawUser?.imperialCharacter?.countryId as string | undefined,
      ].filter((country): country is string => !!country)
    ),
  ].map((code) => ({
    code,
    name: COUNTRY_CONFIGS[code as CountryId]?.name ?? code,
  }));

  const renderBucketQuickSettings = (bucketId: SettingsBucketId) => {
    switch (bucketId) {
      case "game":
        return <GameQuickSettings countries={playerCountries} />;
      case "interface":
        return <InterfaceQuickSettings />;
      case "audio":
        return <AudioQuickSettings />;
      case "data":
        return <DataQuickSettings />;
      default:
        return null;
    }
  };

  const renderSectionCards = (sections: typeof ALL_SECTIONS) => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sections.map((section) => {
        const dangerous = section.id === "danger" || section.id === "character-danger";
        const needsBackground =
          section.id === "demographics" && effectiveCharacter && !effectiveCharacter.demographics;
        return (
          <button
            key={section.id}
            type="button"
            aria-expanded={activeSection === section.id}
            aria-controls={`${section.id}-panel`}
            onClick={() =>
              setActiveSection((current) => (current === section.id ? null : section.id))
            }
            className={`group min-h-28 rounded-2xl border p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              activeSection === section.id
                ? "border-primary bg-primary/10 shadow-sm"
                : dangerous
                  ? "border-error/30 bg-error/[0.04] hover:border-error/60"
                  : needsBackground
                    ? "border-warning/40 bg-warning/[0.04] ring-1 ring-warning/20"
                    : "border-card-border bg-background/45 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card-elevated"
            }`}
          >
            <span
              className={`mb-3 grid h-9 w-9 place-items-center rounded-xl ${
                dangerous
                  ? "bg-error/10 text-error"
                  : activeSection === section.id
                    ? "bg-primary text-white"
                    : "bg-primary/10 text-primary"
              }`}
            >
              <SectionIcon id={section.id} />
            </span>
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">{t(section.labelKey)}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${
                  activeSection === section.id ? "rotate-180 text-primary" : ""
                }`}
              />
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              {t(section.summaryKey)}
            </span>
          </button>
        );
      })}
    </div>
  );

  const sectionSearchText = (section: (typeof ALL_SECTIONS)[number]) =>
    `${t(section.labelKey)} ${t(section.summaryKey)}`;
  const bucketSearchText = (bucket: (typeof CONTROL_PANEL_BUCKETS)[number]) =>
    `${t(bucket.labelKey)} ${t(bucket.summaryKey)}`;

  const hasSearchResults = CONTROL_PANEL_BUCKETS.some((bucket) => {
    const bucketSections = availableSections.filter(
      (section) =>
        bucket.sectionIds.includes(section.id) &&
        sectionMatchesQuery(section, normalizedSearch, sectionSearchText(section))
    );
    return (
      bucketSections.length > 0 ||
      bucketQuickSettingsMatch(bucket, normalizedSearch, bucketSearchText(bucket))
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl overflow-x-hidden px-4 py-7 md:px-6 md:py-10 lg:px-8">
        {/* OAuth result banner */}
        {oauthBanner && (
          <div className="mb-6">
            <MessageBanner
              ok={oauthBanner.ok}
              text={t(oauthBanner.key)}
              onDismiss={() => {
                setOauthBannerDismissed(true);
                router.replace("/settings", { scroll: false });
              }}
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-muted">{t("common.loading")}</p>
            </div>
          </div>
        ) : (
          <>
            <header className="mb-6 md:mb-8">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                    A House Divided
                  </p>
                  <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-5xl">
                    {t("page.title")}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted md:text-base">
                    {t("page.subtitle")}
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-card-border bg-card px-3 py-1.5 text-xs text-muted">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  {t("page.savesInline")}
                </div>
              </div>
            </header>

            <div className="sticky top-16 z-30 mb-7 rounded-2xl border border-card-border bg-card/95 p-2 shadow-lg backdrop-blur-xl md:top-20 md:p-3">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder={t("page.searchPlaceholder")}
                  aria-label={t("page.searchAria")}
                  className="min-h-12 w-full rounded-xl border border-card-border bg-background pl-10 pr-11 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/25"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label={t("page.clearSearchAria")}
                    className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-card-elevated hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </label>
            </div>

            <div className="grid gap-7 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-9">
              <nav
                aria-label={t("page.categoriesAria")}
                className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-40 lg:block lg:self-start lg:overflow-visible lg:pb-0"
              >
                {CONTROL_PANEL_BUCKETS.map((bucket) => (
                  <a
                    key={bucket.id}
                    href={`#settings-${bucket.id}`}
                    onClick={() => setSearchQuery("")}
                    className="group flex min-h-11 shrink-0 items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:border-card-border hover:bg-card hover:text-foreground lg:mb-1 lg:w-full"
                  >
                    <span className="text-primary">
                      <BucketIcon id={bucket.id} />
                    </span>
                    {t(bucket.labelKey)}
                  </a>
                ))}
              </nav>

              <div className="min-w-0 space-y-7">
                {!hasSearchResults && (
                  <div className="rounded-2xl border border-dashed border-card-border bg-card/50 px-6 py-12 text-center">
                    <Search className="mx-auto h-6 w-6 text-muted" />
                    <h2 className="mt-3 text-base font-semibold text-foreground">
                      {t("page.noResultsTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-muted">{t("page.noResultsHint")}</p>
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="mt-4 min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                    >
                      {t("page.clearSearch")}
                    </button>
                  </div>
                )}

                {CONTROL_PANEL_BUCKETS.map((bucket) => {
                  const matchingSections = availableSections.filter(
                    (section) =>
                      bucket.sectionIds.includes(section.id) &&
                      sectionMatchesQuery(section, normalizedSearch, sectionSearchText(section))
                  );
                  const quickMatches = bucketQuickSettingsMatch(
                    bucket,
                    normalizedSearch,
                    bucketSearchText(bucket)
                  );
                  if (matchingSections.length === 0 && !quickMatches) return null;

                  const primarySections = matchingSections.filter(
                    (section) => !ADVANCED_SECTION_IDS.has(section.id)
                  );
                  const advancedSections = matchingSections.filter((section) =>
                    ADVANCED_SECTION_IDS.has(section.id)
                  );
                  const showProfileMedia =
                    bucket.id === "game" &&
                    !!effectiveCharacter &&
                    (!normalizedSearch ||
                      "profile avatar photo header image recommendations".includes(
                        normalizedSearch
                      ));
                  const bucketContainsActive =
                    !!activeDefinition && bucket.sectionIds.includes(activeDefinition.id);

                  return (
                    <section
                      key={bucket.id}
                      id={`settings-${bucket.id}`}
                      className="scroll-mt-40 overflow-hidden rounded-3xl border border-card-border bg-card/75 shadow-sm backdrop-blur-sm"
                    >
                      <div className="border-b border-card-border bg-gradient-to-r from-primary/[0.08] via-transparent to-transparent px-5 py-5 md:px-7">
                        <div className="flex items-start gap-4">
                          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                            <BucketIcon id={bucket.id} />
                          </span>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                              {t(bucket.eyebrowKey)}
                            </p>
                            <h2 className="mt-0.5 text-xl font-bold tracking-tight text-foreground">
                              {t(bucket.labelKey)}
                            </h2>
                            <p className="mt-1 text-sm leading-6 text-muted">
                              {t(bucket.summaryKey)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-5 p-4 md:p-6">
                        {quickMatches && renderBucketQuickSettings(bucket.id)}

                        {showProfileMedia && (
                          <div className="rounded-2xl border border-card-border bg-gradient-to-br from-background/70 to-card-elevated/50 p-4 md:p-5">
                            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {t("page.publicProfileMedia")}
                                </p>
                                <p className="mt-0.5 text-xs text-muted">
                                  {t("page.publicProfileMediaHint")}
                                </p>
                              </div>
                              {recommendations.length > 0 && (
                                <RecommendationsBlurb
                                  recommendations={recommendations}
                                  onSelectSection={selectSection}
                                />
                              )}
                            </div>
                            <div className="grid items-start gap-5 md:grid-cols-[112px_minmax(0,1fr)]">
                              <div>
                                <ProfilePictureUpload
                                  size="compact"
                                  currentUrl={effectiveCharacter.avatarUrl}
                                  characterName={effectiveCharacter.name}
                                  patreonTier={rawUser?.patreonTier ?? null}
                                  patreonExpiresAt={rawUser?.patreonExpiresAt ?? null}
                                  onSuccess={(url) =>
                                    setCharacter((current) =>
                                      current ? { ...current, avatarUrl: url } : null
                                    )
                                  }
                                />
                                <p className="mt-2 text-center text-[11px] text-muted">
                                  {t("page.portrait")}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <ProfileHeaderImageUpload
                                  variant="compact"
                                  currentUrl={effectiveCharacter.profileHeaderImageUrl}
                                  characterName={effectiveCharacter.name}
                                  onSuccess={(url) =>
                                    setCharacter((current) =>
                                      current ? { ...current, profileHeaderImageUrl: url } : null
                                    )
                                  }
                                />
                                <p className="mt-2 text-[11px] text-muted">
                                  {t("page.profileHeader")}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {bucket.id === "game" &&
                          !hasVisibleCharacterSettings &&
                          (!normalizedSearch ||
                            "character create new".includes(normalizedSearch)) && (
                            <div className="rounded-2xl border border-dashed border-card-border bg-background/40 p-6 text-center">
                              <p className="text-sm text-muted">{t("page.noCharacter")}</p>
                              <div className="mt-4 flex flex-wrap justify-center gap-2">
                                <Link
                                  href="/create-character"
                                  className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                                >
                                  {t("page.createCharacter")}
                                </Link>
                                {userData?.isAdmin && (
                                  <Link
                                    href="/create-imperial-character"
                                    className="inline-flex min-h-11 items-center rounded-xl border border-card-border bg-background px-5 py-2.5 text-sm font-medium text-primary transition-colors hover:border-primary/40 hover:bg-card-elevated"
                                  >
                                    {t("page.createImperialCharacter")}
                                  </Link>
                                )}
                              </div>
                            </div>
                          )}

                        {primarySections.length > 0 && renderSectionCards(primarySections)}

                        {advancedSections.length > 0 && (
                          <div className="rounded-2xl border border-card-border bg-card-muted/50 p-4">
                            <div className="mb-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                                {t("page.advancedTitle")}
                              </p>
                              <p className="mt-1 text-xs text-muted">{t("page.advancedHint")}</p>
                            </div>
                            {renderSectionCards(advancedSections)}
                          </div>
                        )}

                        {bucket.id === "game" &&
                          hasVisibleCharacterSettings &&
                          !normalizedSearch && (
                            <div className="flex flex-wrap gap-2 border-t border-card-border pt-4">
                              {hasImperialCharacter && (
                                <button
                                  type="button"
                                  onClick={handleSwitchCharacterType}
                                  className="min-h-11 rounded-xl border border-card-border bg-background px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-primary/40 hover:bg-card-elevated"
                                >
                                  {isImperial
                                    ? t("page.switchToRegular")
                                    : t("page.switchToImperial")}
                                </button>
                              )}
                              {userData?.isAdmin && (
                                <>
                                  <Link
                                    href="/create-character"
                                    className="inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-sm font-medium text-primary hover:bg-background"
                                  >
                                    {t("page.createAnotherCharacter")}
                                  </Link>
                                  <Link
                                    href="/create-imperial-character"
                                    className="inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-sm font-medium text-primary/75 hover:bg-background hover:text-primary"
                                  >
                                    {t("page.createImperialCharacterPlus")}
                                  </Link>
                                </>
                              )}
                            </div>
                          )}

                        {bucketContainsActive &&
                          activeSection &&
                          (!normalizedSearch ||
                            (activeDefinition &&
                              sectionMatchesQuery(
                                activeDefinition,
                                normalizedSearch,
                                sectionSearchText(activeDefinition)
                              ))) && (
                            <section
                              id={`${activeSection}-panel`}
                              className={`overflow-hidden rounded-2xl border shadow-lg ${
                                activeSection === "danger" || activeSection === "character-danger"
                                  ? "border-error/35 bg-error/[0.04]"
                                  : "border-primary/30 bg-background/75"
                              }`}
                            >
                              <div className="flex items-center gap-3 border-b border-card-border px-5 py-4 md:px-6">
                                <span
                                  className={
                                    activeSection === "danger" ||
                                    activeSection === "character-danger"
                                      ? "text-error"
                                      : "text-primary"
                                  }
                                >
                                  <SectionIcon id={activeSection} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-foreground">
                                    {activeDefinition && t(activeDefinition.labelKey)}
                                  </p>
                                  <p className="text-xs text-muted">
                                    {activeDefinition && t(activeDefinition.summaryKey)}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={goToOverview}
                                  aria-label={t("page.closePanelAria", {
                                    label: activeDefinition
                                      ? t(activeDefinition.labelKey)
                                      : t("page.title"),
                                  })}
                                  className="grid h-10 w-10 place-items-center rounded-xl text-muted transition-colors hover:bg-card hover:text-foreground"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="px-5 pb-6 pt-5 md:px-7 md:pb-7">
                                {renderSectionContent(activeSection)}
                              </div>
                            </section>
                          )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>

            <div className="mt-12">
              <Link
                href="/dashboard"
                className="text-sm text-muted hover:text-foreground transition-colors inline-flex items-center gap-1.5"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                {t("page.backToDashboard")}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BucketIcon({ id }: { id: SettingsBucketId }) {
  const className = "h-5 w-5";
  switch (id) {
    case "account":
      return <ShieldCheck className={className} />;
    case "game":
      return <Gamepad2 className={className} />;
    case "interface":
      return <MonitorCog className={className} />;
    case "audio":
      return <Volume2 className={className} />;
    case "data":
      return <Database className={className} />;
  }
}

function SettingsPageFallback() {
  const t = useTranslations("settings");
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-[50vh] max-w-6xl items-center justify-center px-4 py-8 md:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-muted">{t("common.loading")}</p>
        </div>
      </div>
    </div>
  );
}

/** useSearchParams requires a Suspense boundary (Next.js CSR bailout — avoids root error.tsx). */
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsPageFallback />}>
      <SettingsPageContent />
    </Suspense>
  );
}
