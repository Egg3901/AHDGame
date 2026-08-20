"use client";

/**
 * ExperimentalNavbar — the redesigned primary navigation, imported from the
 * "AHD Navbar" Claude Design doc. This is now the DEFAULT navbar, selected in
 * NavbarWrapper; the classic {@link Navbar} is the opt-out for users who set
 * `enableExperimentalUI === false` (Settings → Appearance → "Use the classic
 * interface"). The name is kept for continuity.
 *
 * Visuals use the app's themed Tailwind tokens (foreground/muted/card/primary…)
 * so it inherits all 11 themes. The desktop bar mirrors the classic {@link Navbar}
 * organization — logo left; text-forward tabs + icon cluster hug the right; a thin
 * underline for the active tab; an inline expanding search — with the top tabs in
 * the production order (Actions · State · Nation · World · Help · Staff). Keeps this
 * redesign's avatar/profile dropdown (notifications folded in) and the improved
 * mobile collapsed bar + slide-down menu.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCountryContext } from "@/hooks/useCountryContext";
import { useActiveCharters } from "@/hooks/useActiveCharters";
import { useActiveReferendumCampaign } from "@/hooks/useActiveReferendumCampaign";
import { useActivePresidentElection } from "@/hooks/useActivePresidentElection";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { UniversalSearch } from "./UniversalSearch";
import { Avatar } from "./Avatar";
import { CountryFlag } from "@/components/CountryFlag";
import { getCountryConfig, getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import { useEnabledCountries, useActivePreset } from "@/contexts/RegisteredCountriesContext";
import {
  countryUrl,
  partyUrl,
  regionUrl,
  regionPartyUrl,
  regionLegislatureUrl,
  regionElectionsUrl,
  cabinetOfficeUrl,
} from "@/lib/urls";
import { UK_NATIONS, UK_REGIONS } from "@/lib/constants/uk";
import {
  HELP_DISCORD_URL,
  HELP_PATREON_URL,
  HELP_SUPPORTER_WALL_URL,
  HELP_SUPPORT_EMAIL,
} from "./HelpDropdown";
import { buildNationalDetailsSections } from "@/components/navbar/nationDetailsSections";
import { visibleWorldNavItems } from "@/components/navbar/worldNavItems";
import { visibleProfileOrgItems } from "@/components/navbar/profileNavItems";
import { visibleStaffNavItems } from "@/components/navbar/staffNavItems";
import {
  Chevron,
  DropdownPanel,
  MenuLabel,
  MenuRow,
  NavIcon,
  NavItemChevron,
  NavItemLabel,
  isNavActive,
  navTabClassName,
} from "@/components/navbar/experimentalNavPrimitives";
import { ExperimentalUserMenu } from "@/components/navbar/ExperimentalUserMenu";
import { ExperimentalMobileMenu } from "@/components/navbar/ExperimentalMobileMenu";
import type {
  AdminCharacter,
  CharacterProfile,
  ExperimentalNavItem,
  ImperialCharacterNav,
  MobileSubKey,
  NavLinkRef,
  OpenKey,
} from "@/components/navbar/experimentalNavTypes";

export interface ExperimentalNavbarProps {
  user?: NavLinkRef;
  showProfile?: boolean;
  currentParty?: { id: string; name: string; countryId: string };
  unreadCount?: number;
  characterProfile?: CharacterProfile;
  onOpenFeedback?: () => void;
  feedbackCapturing?: boolean;
  initialPageCountry?: CountryId | null;
  homeState?: { id: string; name: string; countryId: string };
  activeElection?: { id: string; seatId?: string; label: string };
  cabinetOffice?: { positionId: string; positionName: string; countryCode: string };
  governorOffice?: { stateId: string; stateName: string; countryCode: string };
  isImperialMode?: boolean;
  wikiDisabled?: boolean;
  myCorporationId?: number | null;
  myUnionId?: string | null;
  adminCharacters?: AdminCharacter[];
  imperialCharacter?: ImperialCharacterNav;
  conflictsEnabled?: boolean;
  unionsEnabled?: boolean;
  settlementCrisisLive?: boolean;
  activePresidentElectionId?: string;
  activePresidentElectionSeatId?: string;
}

export const ExperimentalNavbar = React.memo(function ExperimentalNavbar({
  user,
  showProfile = false,
  currentParty,
  unreadCount = 0,
  characterProfile,
  onOpenFeedback,
  feedbackCapturing = false,
  initialPageCountry,
  homeState,
  activeElection,
  cabinetOffice,
  governorOffice,
  isImperialMode = false,
  wikiDisabled = false,
  myCorporationId,
  myUnionId,
  adminCharacters,
  imperialCharacter,
  conflictsEnabled = false,
  unionsEnabled = false,
  settlementCrisisLive = false,
  activePresidentElectionId: _activePresidentElectionId,
  activePresidentElectionSeatId: _activePresidentElectionSeatId,
}: ExperimentalNavbarProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { pageCountry, userCountry } = useCountryContext(
    homeState?.id,
    homeState?.countryId,
    initialPageCountry
  );

  const [open, setOpen] = useState<OpenKey>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSubOpen, setMobileSubOpen] = useState<Partial<Record<MobileSubKey, boolean>>>({});
  const [switchingCharacter, setSwitchingCharacter] = useState(false);
  const [switchingImperial, setSwitchingImperial] = useState(false);
  // Collapsible National Details sub-sections (Economy): closed by default;
  // reset whenever a different dropdown opens so each open starts collapsed.
  const [expandedNationSections, setExpandedNationSections] = useState<Record<string, boolean>>({});

  const barRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const dropdownAnchorRef = useRef<HTMLDivElement>(null);
  const dropdownPanelRef = useRef<HTMLDivElement>(null);

  const nationMenuOpen = open === "nation" || open === "country";
  const activeCharters = useActiveCharters(nationMenuOpen || mobileMenuOpen);
  const hasActiveReferendumCampaign = useActiveReferendumCampaign(
    pageCountry as CountryId,
    nationMenuOpen || mobileMenuOpen
  );
  const activePresidentElection = useActivePresidentElection(
    pageCountry as CountryId,
    nationMenuOpen || mobileMenuOpen
  );

  const toggleMobileSub = useCallback((key: MobileSubKey) => {
    setMobileSubOpen((cur) => ({ ...cur, [key]: !cur[key] }));
  }, []);

  const toggle = useCallback((key: Exclude<OpenKey, null>) => {
    setExpandedNationSections({});
    setOpen((cur) => (cur === key ? null : key));
  }, []);
  const closeAll = useCallback(() => setOpen(null), []);

  // Close dropdowns / the expanding search on outside click or Esc.
  // Portal-mounted panels live outside barRef, so check both refs.
  useEffect(() => {
    if (open === null && !searchOpen) return;

    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (barRef.current?.contains(target)) return;
      if (dropdownPanelRef.current?.contains(target)) return;
      closeAll();
      setSearchOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeAll();
        setSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, searchOpen, closeAll]);
  const handleSignOut = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (res.ok) window.location.assign("/");
    } catch {
      /* ignore */
    }
  }, []);

  const handleSwitchCharacter = useCallback(
    async (characterId: string) => {
      if (switchingCharacter) return;
      setSwitchingCharacter(true);
      try {
        const res = await fetch("/api/auth/active-character", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId }),
        });
        if (res.ok) window.location.reload();
      } catch {
        /* ignore */
      } finally {
        setSwitchingCharacter(false);
      }
    },
    [switchingCharacter]
  );

  const handleSwitchImperial = useCallback(
    async (type: "character" | "imperial") => {
      if (switchingImperial) return;
      setSwitchingImperial(true);
      try {
        const res = await fetch("/api/imperial-characters/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        if (res.ok) window.location.reload();
      } catch {
        /* ignore */
      } finally {
        setSwitchingImperial(false);
      }
    },
    [switchingImperial]
  );

  const countryConf = getCountryConfig(pageCountry as CountryId);
  // Country-context awareness (matches the classic nav): the switcher lists the
  // nations actually registered in the current game, named per the active
  // preset/era — not every non-coming-soon country with its default name.
  const preset = useActivePreset();
  const switchableCountries = useEnabledCountries();

  // State legislature label (UK devolution-aware).
  const stateLegislatureLabel = (() => {
    if (!homeState || homeState.countryId !== "UK") return t("state.legislature");
    const nation = UK_NATIONS.find((n) => n.id === homeState.id);
    if (nation?.devolvedBody) return nation.devolvedBody;
    const region = UK_REGIONS.find((r) => r.id === homeState.id);
    const parentNation = UK_NATIONS.find((n) => n.id === region?.nationId);
    return parentNation?.devolvedBody ?? t("state.legislature");
  })();

  const canAccessSandbox =
    user?.isAdmin ||
    user?.isModerator ||
    ((user?.patreonTier === "supporter-plus" || user?.patreonTier === "supporter-plus-plus") &&
      user?.isPatronActive);
  const showWiki = !!(user?.isAdmin || user?.isModerator) || !wikiDisabled;

  // Top-level tabs: Actions · State · Nation · World (Help and Staff are
  // appended in the bar). Corp and union live on the avatar profile card.
  const navItems: ExperimentalNavItem[] = [];

  if (showProfile && !isImperialMode) {
    navItems.push({ label: t("common.actions"), href: "/actions", icon: "Actions" });
  }

  if (showProfile && homeState) {
    navItems.push({
      label: homeState.name,
      href: regionUrl(homeState.countryId, homeState.id),
      key: "state",
      icon: "State",
    });
  }

  if (showProfile) {
    navItems.push(
      {
        label: getCountryDisplayName(pageCountry as CountryId, preset),
        href: countryUrl(pageCountry as CountryId),
        key: "nation",
        icon: "Nation",
        useFlag: true,
      },
      { label: t("common.world"), href: "/world", key: "world", icon: "World" }
    );
  }

  const charterEntry =
    activeCharters && activeCharters.length > 0
      ? {
          href: activeCharters.length === 1 ? `/charters/${activeCharters[0]!.id}` : "/charters",
          label:
            activeCharters.length === 1
              ? t("menus.nation.charterSingle", { name: activeCharters[0]!.proposedName })
              : t("menus.nation.chartersMultiple", { count: activeCharters.length }),
        }
      : null;

  const nationalDetailSections = buildNationalDetailsSections(pageCountry as CountryId, {
    activePresidentElection,
    charters: charterEntry,
    hasActiveReferendumCampaign,
    unionsEnabled,
  });

  const worldSubItems = visibleWorldNavItems({
    countryId: pageCountry,
    myCorporationId,
    conflictsEnabled,
    unionsEnabled,
    settlementCrisisLive,
  });

  const profileOrgItems = visibleProfileOrgItems({
    myCorporationId,
    myUnionId,
    unionsEnabled,
  });

  const staffSubItems =
    user?.isAdmin || user?.isModerator
      ? visibleStaffNavItems({ isAdmin: !!user?.isAdmin, isModerator: !!user?.isModerator })
      : [];

  // ── Dropdown panels ────────────────────────────────────────────────────────
  const worldMenu = (
    <DropdownPanel
      anchorRef={dropdownAnchorRef}
      panelRef={dropdownPanelRef}
      align="left"
      width="w-[220px]"
    >
      {worldSubItems.map((item, idx) => {
        const prev = worldSubItems[idx - 1];
        const showLeaderboardHeader =
          item.section === "leaderboard" && prev?.section !== "leaderboard";
        const showMarketsHeader =
          item.section === "main" &&
          item.id === "stockMarket" &&
          prev &&
          (prev.section === "leaderboard" || prev.section === "corporate");
        return (
          <React.Fragment key={item.id}>
            {showLeaderboardHeader && (
              <>
                <div className="px-2.5 pb-1 pt-2 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {t("menus.world.headers.leaderboard")}
                  </span>
                  <span className="rounded-full bg-warning/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-warning">
                    {t("menus.world.headers.beta")}
                  </span>
                </div>
              </>
            )}
            {showMarketsHeader && (
              <>
                <div className="my-1 mx-2.5 h-px bg-card-border" />
                <MenuLabel>{t("menus.world.headers.markets")}</MenuLabel>
              </>
            )}
            {item.section === "main" && item.id === "nations" && (
              <MenuLabel>{t("menus.world.headers.international")}</MenuLabel>
            )}
            {item.section === "main" && item.id === "sectors" && (
              <>
                <div className="my-1 mx-2.5 h-px bg-card-border" />
                <MenuLabel>{t("menus.world.headers.browse")}</MenuLabel>
              </>
            )}
            <MenuRow
              href={item.href}
              onNavigate={closeAll}
              strong={item.id === "legacyLeaderboard"}
              dot={item.primary ? "bg-primary" : undefined}
              nested={item.parentId != null}
            >
              {t(item.labelKey)}
            </MenuRow>
          </React.Fragment>
        );
      })}
    </DropdownPanel>
  );

  const nationMenu = showProfile ? (
    <DropdownPanel
      anchorRef={dropdownAnchorRef}
      panelRef={dropdownPanelRef}
      align="left"
      width="w-[240px]"
      padded={false}
    >
      <div className="p-1.5">
        <MenuLabel>{t("menus.nation.homeNation")}</MenuLabel>
        <MenuRow href={countryUrl(userCountry as CountryId)} onNavigate={closeAll} strong>
          {getCountryDisplayName(userCountry as CountryId, preset)}
        </MenuRow>
        {cabinetOffice && (
          <MenuRow
            href={cabinetOfficeUrl(cabinetOffice.countryCode, cabinetOffice.positionId)}
            onNavigate={closeAll}
          >
            {t("menus.nation.cabinetOffice")}
          </MenuRow>
        )}
        {currentParty && (
          <MenuRow
            href={partyUrl(currentParty.countryId ?? pageCountry, currentParty.id)}
            onNavigate={closeAll}
          >
            {t("menus.nation.myParty")} · {currentParty.name}
          </MenuRow>
        )}
        {userCountry === "US" && (
          <MenuRow href="/political-operations" onNavigate={closeAll}>
            {t("menus.nation.myPoliticalOperations")}
          </MenuRow>
        )}
      </div>
      <div className="border-t border-card-border p-1.5">
        <MenuLabel>{t("menus.nation.nationalDetails")}</MenuLabel>
        {nationalDetailSections.map((section) => {
          const isCollapsible = section.collapsible === true;
          const isExpanded = !isCollapsible || expandedNationSections[section.title] === true;
          return (
            <div key={section.title}>
              {isCollapsible ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedNationSections((prev) => ({
                      ...prev,
                      [section.title]: !prev[section.title],
                    }))
                  }
                  aria-expanded={isExpanded}
                  className="flex w-full items-center justify-between px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted/80 transition-colors hover:text-foreground"
                >
                  {t(section.titleKey)}
                  {/* Explicit `text-muted` — same fix as CollapsibleNavSection
                      (mobile): the chevron must read at full contrast even
                      though the label itself stays a faint small-caps tag. */}
                  <svg
                    className={`h-4 w-4 shrink-0 text-muted transition-transform duration-300 ease-out ${isExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              ) : (
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted/80">
                  {t(section.titleKey)}
                </div>
              )}
              {isExpanded &&
                section.items.map((item) => (
                  <MenuRow key={item.id} href={item.href} onNavigate={closeAll}>
                    {item.labelKey ? t(item.labelKey) : item.label}
                  </MenuRow>
                ))}
            </div>
          );
        })}
      </div>
    </DropdownPanel>
  ) : null;

  const stateMenu = homeState ? (
    <DropdownPanel
      anchorRef={dropdownAnchorRef}
      panelRef={dropdownPanelRef}
      align="left"
      width="w-[220px]"
    >
      <MenuLabel>{homeState.name}</MenuLabel>
      <MenuRow href={regionUrl(homeState.countryId, homeState.id)} onNavigate={closeAll} strong>
        {t("state.overview")}
      </MenuRow>
      {currentParty && (
        <MenuRow
          href={regionPartyUrl(homeState.countryId, homeState.id, currentParty.id)}
          onNavigate={closeAll}
        >
          {homeState.name} · {currentParty.name}
        </MenuRow>
      )}
      <MenuRow
        href={`${regionUrl(homeState.countryId, homeState.id)}?tab=economy`}
        onNavigate={closeAll}
      >
        {t("state.economy")}
      </MenuRow>
      <MenuRow href={regionElectionsUrl(homeState.countryId, homeState.id)} onNavigate={closeAll}>
        {t("state.elections")}
      </MenuRow>
      <MenuRow href={regionLegislatureUrl(homeState.countryId, homeState.id)} onNavigate={closeAll}>
        {stateLegislatureLabel}
      </MenuRow>
      {governorOffice && governorOffice.stateId === homeState.id && (
        <MenuRow
          href={`/country/${homeState.countryId.toLowerCase()}/region/${homeState.id.toLowerCase()}/office`}
          onNavigate={closeAll}
        >
          {t("state.governorOffice")}
        </MenuRow>
      )}
      {cabinetOffice && (
        <MenuRow
          href={`/country/${cabinetOffice.countryCode}/executive/cabinet/${cabinetOffice.positionId}/office`}
          onNavigate={closeAll}
        >
          {t("menus.nation.cabinetOffice")} · {cabinetOffice.positionName}
        </MenuRow>
      )}
      {activeElection ? (
        <MenuRow
          href={`/elections/${activeElection.seatId ?? activeElection.id}`}
          onNavigate={closeAll}
          metaClass="text-primary"
          meta={t("common.active")}
        >
          {t("state.myElection")}
        </MenuRow>
      ) : null}
    </DropdownPanel>
  ) : null;

  const helpMenu = (
    <DropdownPanel
      anchorRef={dropdownAnchorRef}
      panelRef={dropdownPanelRef}
      align="right"
      width="w-[220px]"
    >
      <MenuLabel>{t("help.resources")}</MenuLabel>
      <MenuRow
        href={showWiki ? "https://wiki.ahousedividedgame.com" : "/guides"}
        onNavigate={closeAll}
      >
        {showWiki ? t("help.wikiGuides") : t("help.guides")}
      </MenuRow>
      <MenuRow href="/about" onNavigate={closeAll}>
        {t("help.about")}
      </MenuRow>
      <MenuRow href="/feedback" onNavigate={closeAll}>
        {t("help.suggestions")}
      </MenuRow>
      <div className="my-1 mx-2.5 h-px bg-card-border" />
      <MenuLabel>{t("help.community")}</MenuLabel>
      <a
        href={HELP_DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={closeAll}
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 transition-colors hover:bg-white/5"
      >
        Discord
      </a>
      <a
        href={HELP_PATREON_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={closeAll}
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 transition-colors hover:bg-white/5"
      >
        {t("help.patreon")}
      </a>
      <a
        href={HELP_SUPPORTER_WALL_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={closeAll}
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 transition-colors hover:bg-white/5"
      >
        {t("help.supporterWall")}
      </a>
      <a
        href={HELP_SUPPORT_EMAIL}
        onClick={closeAll}
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 transition-colors hover:bg-white/5"
      >
        {t("help.emailSupport")}
      </a>
      {onOpenFeedback && (
        <button
          type="button"
          onClick={() => {
            closeAll();
            onOpenFeedback();
          }}
          disabled={feedbackCapturing}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-fg-2 transition-colors hover:bg-white/5 disabled:cursor-wait disabled:opacity-70"
        >
          {feedbackCapturing ? t("common.capturingScreenshot") : t("common.quickSuggest")}
        </button>
      )}
      <div className="my-1 mx-2.5 h-px bg-card-border" />
      <MenuRow href="/privacy" onNavigate={closeAll}>
        {t("help.privacy")}
      </MenuRow>
      <MenuRow href="/terms" onNavigate={closeAll}>
        {t("help.terms")}
      </MenuRow>
    </DropdownPanel>
  );

  const staffMenu = (
    <DropdownPanel
      anchorRef={dropdownAnchorRef}
      panelRef={dropdownPanelRef}
      align="right"
      width="w-52"
    >
      <MenuLabel>{t("common.staff")}</MenuLabel>
      {staffSubItems.map((item) =>
        item.external ? (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeAll}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 transition-colors hover:bg-white/5"
          >
            {t(item.labelKey)}
          </a>
        ) : (
          <MenuRow key={item.label} href={item.href} onNavigate={closeAll}>
            {t(item.labelKey)}
          </MenuRow>
        )
      )}
    </DropdownPanel>
  );

  // User / profile dropdown
  const profileDisplayName = characterProfile?.name ?? user?.username ?? "";
  const userMenu = user ? (
    <ExperimentalUserMenu
      user={user}
      characterProfile={characterProfile}
      profileDisplayName={profileDisplayName}
      showProfile={showProfile}
      isImperialMode={isImperialMode}
      unreadCount={unreadCount}
      adminCharacters={adminCharacters}
      imperialCharacter={imperialCharacter}
      switchingCharacter={switchingCharacter}
      switchingImperial={switchingImperial}
      canAccessSandbox={canAccessSandbox}
      profileOrgItems={profileOrgItems}
      closeAll={closeAll}
      handleSwitchCharacter={handleSwitchCharacter}
      handleSwitchImperial={handleSwitchImperial}
      handleSignOut={handleSignOut}
      anchorRef={dropdownAnchorRef}
      panelRef={dropdownPanelRef}
    />
  ) : null;

  return (
    <>
      <nav
        className="ahd-navbar-enter sticky top-0 z-50 border-b border-card-border/60 bg-card/50 shadow-panel backdrop-blur-xl"
        aria-label={t("common.mainNavigation")}
        data-feedback-ignore="true"
      >
        {/* The signature top accent + shimmer is rendered globally by
            NavbarTopFlair (a fixed strip in NavbarWrapper), matching the design. */}
        <div ref={barRef}>
          {/* ── Desktop bar ──────────────────────────────────────────────── */}
          <div className="mx-auto hidden min-h-[60px] max-w-7xl items-center justify-between gap-3 overflow-visible px-5 md:flex">
            {/* Brand */}
            <Link
              href="/profile"
              className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
            >
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white p-0.5 ring-1 ring-white/10">
                <Image
                  src={CDN_LOGO_URL}
                  unoptimized
                  alt="A House Divided"
                  width={30}
                  height={30}
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="whitespace-nowrap font-serif text-base font-bold tracking-tight text-foreground">
                A House Divided
              </span>
            </Link>

            {/* Right group — primary tabs + icon cluster hug the right, classic-nav style */}
            <div className="relative flex min-w-0 flex-1 items-center justify-end gap-2 overflow-visible">
              {/* Primary nav — text-forward tabs; fade out while the search overlay is open */}
              <div
                className={`flex min-w-0 items-center gap-0.5 overflow-visible transition-opacity duration-200 ${searchOpen ? "pointer-events-none opacity-0" : "opacity-100"}`}
                aria-hidden={searchOpen ? "true" : undefined}
              >
                {navItems.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  const tabIcon = item.useFlag ? (
                    <CountryFlag country={pageCountry} size="sm" />
                  ) : (
                    <NavIcon name={item.icon} />
                  );
                  if (item.key) {
                    const isOpen = open === item.key;
                    return (
                      <div
                        key={item.label}
                        className="relative shrink-0"
                        ref={isOpen ? dropdownAnchorRef : undefined}
                      >
                        <button
                          type="button"
                          onClick={() => toggle(item.key!)}
                          aria-expanded={isOpen}
                          aria-haspopup="menu"
                          className={navTabClassName(active || isOpen)}
                        >
                          {tabIcon}
                          <NavItemLabel>{item.label}</NavItemLabel>
                          <NavItemChevron open={isOpen} />
                        </button>
                        {isOpen &&
                          (item.key === "state"
                            ? stateMenu
                            : item.key === "world"
                              ? worldMenu
                              : item.key === "nation"
                                ? nationMenu
                                : null)}
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      data-coach={item.href === "/actions" ? "nav-actions" : undefined}
                      className={navTabClassName(active)}
                    >
                      {tabIcon}
                      <NavItemLabel>{item.label}</NavItemLabel>
                    </Link>
                  );
                })}

                {/* Help — classic-nav order: after World */}
                <div
                  className="relative shrink-0"
                  ref={open === "help" ? dropdownAnchorRef : undefined}
                >
                  <button
                    type="button"
                    onClick={() => toggle("help")}
                    aria-expanded={open === "help"}
                    aria-haspopup="menu"
                    className={navTabClassName(open === "help")}
                  >
                    <NavIcon name="Help" />
                    <NavItemLabel>{t("common.help")}</NavItemLabel>
                    <NavItemChevron open={open === "help"} />
                  </button>
                  {open === "help" && helpMenu}
                </div>

                {/* Staff — admin/mod only */}
                {(user?.isAdmin || user?.isModerator) && staffSubItems.length > 0 && (
                  <div
                    className="relative shrink-0"
                    ref={open === "staff" ? dropdownAnchorRef : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => toggle("staff")}
                      aria-expanded={open === "staff"}
                      aria-haspopup="menu"
                      className={navTabClassName(open === "staff")}
                    >
                      <NavIcon name="Staff" />
                      <NavItemLabel>{t("common.staff")}</NavItemLabel>
                      <NavItemChevron open={open === "staff"} />
                    </button>
                    {open === "staff" && staffMenu}
                  </div>
                )}
              </div>

              {/* Icon cluster */}
              <div className="relative flex shrink-0 items-center gap-1.5">
                {/* Country switcher */}
                <div className="relative" ref={open === "country" ? dropdownAnchorRef : undefined}>
                  <button
                    type="button"
                    onClick={() => toggle("country")}
                    aria-expanded={open === "country"}
                    aria-label={t("countrySwitcher.switchNationViewCurrent", {
                      country: getCountryDisplayName(pageCountry as CountryId, preset),
                    })}
                    title={t("countrySwitcher.switchNationView")}
                    className="flex h-9 items-center gap-2 rounded-lg border border-card-border bg-card px-2.5 text-xs font-medium text-fg-2 transition-colors hover:border-muted/50 hover:text-foreground"
                  >
                    <CountryFlag country={pageCountry} size="sm" />
                    <span>{countryConf.code}</span>
                    <Chevron open={open === "country"} />
                  </button>
                  {open === "country" && (
                    <DropdownPanel
                      anchorRef={dropdownAnchorRef}
                      panelRef={dropdownPanelRef}
                      align="right"
                      width="w-64"
                    >
                      <MenuLabel>{t("countrySwitcher.switchNationView")}</MenuLabel>
                      {switchableCountries.map((c) => {
                        const isCurrent = c === pageCountry;
                        const isHome = c === userCountry;
                        return (
                          <Link
                            key={c}
                            href={countryUrl(c)}
                            onClick={closeAll}
                            aria-current={isCurrent ? "true" : undefined}
                            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/5"
                          >
                            <CountryFlag country={c} size="sm" />
                            <span
                              className={`text-[13px] ${isCurrent ? "font-semibold text-foreground" : "text-fg-2"}`}
                            >
                              {getCountryDisplayName(c, preset)}
                            </span>
                            <span className="ml-auto flex items-center gap-1.5">
                              {isHome && (
                                <span className="text-[10px] font-medium text-muted">
                                  {t("countrySwitcher.homeBadge")}
                                </span>
                              )}
                              {isCurrent && (
                                <svg
                                  className="h-[15px] w-[15px] text-primary"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2.6}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                          </Link>
                        );
                      })}
                    </DropdownPanel>
                  )}
                </div>

                {/* Expanding search — grows leftward over the nav tabs (classic-nav behaviour) */}
                <div
                  ref={searchContainerRef}
                  className={`absolute right-full top-1/2 mr-1.5 -translate-y-1/2 overflow-hidden transition-all duration-300 ease-out ${
                    searchOpen ? "w-[min(26rem,60vw)] opacity-100" : "w-0 opacity-0"
                  }`}
                  style={{ pointerEvents: searchOpen ? "auto" : "none" }}
                >
                  <UniversalSearch open={searchOpen} />
                </div>

                {/* Search toggle */}
                <button
                  type="button"
                  onClick={() => setSearchOpen((v) => !v)}
                  aria-label={t("common.search")}
                  aria-expanded={searchOpen}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-card transition-colors hover:border-muted/50 ${
                    searchOpen ? "text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  <svg
                    className="h-[17px] w-[17px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>

                {/* Wallet */}
                {showProfile && (
                  <Link
                    href="/portfolio?tab=currency"
                    aria-label={t("common.wallet")}
                    aria-current={isNavActive(pathname, "/portfolio") ? "page" : undefined}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-card transition-colors hover:border-muted/50 ${isNavActive(pathname, "/portfolio") ? "text-foreground" : "text-muted hover:text-foreground"}`}
                  >
                    <svg
                      className="h-[17px] w-[17px]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </Link>
                )}

                {/* User / avatar dropdown */}
                <div className="relative" ref={open === "user" ? dropdownAnchorRef : undefined}>
                  {user ? (
                    <>
                      <button
                        type="button"
                        onClick={() => toggle("user")}
                        aria-expanded={open === "user"}
                        aria-label={t("common.userMenu")}
                        className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-card-border bg-card transition-opacity hover:opacity-90 ${open === "user" ? "ring-2 ring-primary/40" : ""}`}
                      >
                        <Avatar
                          url={characterProfile?.avatarUrl}
                          name={profileDisplayName}
                          size="h-9 w-9"
                          borderKey={characterProfile?.borderKey}
                          tintColor={characterProfile?.tintColor}
                          className="rounded-lg"
                        />
                      </button>
                      {open === "user" && userMenu}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Link
                        href="/login"
                        className="text-[13px] font-medium text-muted transition-colors hover:text-foreground"
                      >
                        {t("common.signIn")}
                      </Link>
                      <Link
                        href="/register"
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-white transition-all hover:bg-primary/90"
                      >
                        {t("common.register")}
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Mobile bar ───────────────────────────────────────────────── */}
          <div className="mx-auto flex h-14 items-center gap-2.5 px-3.5 md:hidden">
            <Link href="/profile" className="flex shrink-0 items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white p-0.5">
                <Image
                  src={CDN_LOGO_URL}
                  unoptimized
                  alt="A House Divided"
                  width={28}
                  height={28}
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="whitespace-nowrap font-serif text-[15px] font-bold tracking-tight text-foreground">
                A House Divided
              </span>
            </Link>
            <div className="ml-auto flex items-center gap-1.5">
              {showProfile && user && (
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  aria-label={t("common.openMenu")}
                  className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-card-border bg-card"
                >
                  <Avatar
                    url={characterProfile?.avatarUrl}
                    name={profileDisplayName}
                    size="h-9 w-9"
                    borderKey={characterProfile?.borderKey}
                    tintColor={characterProfile?.tintColor}
                    className="rounded-lg"
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                aria-label={mobileMenuOpen ? t("common.closeMenu") : t("common.openMenu")}
                aria-expanded={mobileMenuOpen}
                aria-controls="experimental-mobile-menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-card text-foreground transition-colors hover:bg-white/5"
              >
                <svg
                  className="h-[19px] w-[19px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {mobileMenuOpen ? (
                    <path d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* ── Mobile menu panel ────────────────────────────────────────── */}
          {mobileMenuOpen && (
            <ExperimentalMobileMenu
              navItems={navItems}
              pathname={pathname}
              mobileSubOpen={mobileSubOpen}
              toggleMobileSub={toggleMobileSub}
              onClose={() => setMobileMenuOpen(false)}
              user={user}
              showProfile={showProfile}
              characterProfile={characterProfile}
              profileDisplayName={profileDisplayName}
              unreadCount={unreadCount}
              currentParty={currentParty}
              homeState={homeState}
              activeElection={activeElection}
              cabinetOffice={cabinetOffice}
              governorOffice={governorOffice}
              stateLegislatureLabel={stateLegislatureLabel}
              pageCountry={pageCountry}
              userCountry={userCountry}
              preset={preset}
              switchableCountries={switchableCountries}
              worldSubItems={worldSubItems}
              profileOrgItems={profileOrgItems}
              staffSubItems={staffSubItems}
              charterEntry={charterEntry}
              hasActiveReferendumCampaign={hasActiveReferendumCampaign}
              unionsEnabled={unionsEnabled}
              showWiki={showWiki}
              onOpenFeedback={onOpenFeedback}
              feedbackCapturing={feedbackCapturing}
              handleSignOut={handleSignOut}
            />
          )}
        </div>
      </nav>
    </>
  );
});
