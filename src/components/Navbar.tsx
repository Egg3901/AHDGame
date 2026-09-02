"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useClickOutside } from "@/hooks/useClickOutside";
import { fetchJson } from "@/lib/observability/fetchJson";
import { useNavbarState } from "./navbar/useNavbarState";
import { isActionRequiredType } from "@/lib/inbox";
import type { NotificationType } from "@/lib/db/types/notifications";
import Link from "next/link";
import Image from "next/image";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { usePathname } from "next/navigation";
import { StateDropdown } from "./StateDropdown";
import { StaffDropdown } from "./StaffDropdown";
import { NationDropdown } from "./NationDropdown";
import { MobileNationalDetails } from "./navbar/MobileNationalDetails";
import { WorldDropdown } from "./WorldDropdown";
import { SettingsDropdown } from "./SettingsDropdown";
import { CountryFlag } from "@/components/CountryFlag";
import {
  HelpDropdown,
  HELP_DISCORD_URL,
  HELP_PATREON_URL,
  HELP_SUPPORTER_WALL_URL,
  HELP_SUPPORT_EMAIL,
  HELP_STATUS_URL,
} from "./HelpDropdown";
import { UniversalSearch } from "./UniversalSearch";
import { type CountryId } from "@/lib/constants/countries";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import { useCountryContext } from "@/hooks/useCountryContext";
import { useActiveCharters } from "@/hooks/useActiveCharters";
import { useActiveReferendumCampaign } from "@/hooks/useActiveReferendumCampaign";
import { UK_NATIONS, UK_REGIONS } from "@/lib/constants/uk";
import {
  regionUrl,
  regionPartyUrl,
  regionLegislatureUrl,
  regionElectionsUrl,
  partyUrl,
  countryUrl,
} from "@/lib/urls";
import { visibleStaffNavItems } from "@/components/navbar/staffNavItems";
import { visibleWorldNavItems } from "@/components/navbar/worldNavItems";
import {
  MOBILE_MENU_PANEL_CLASS,
  NOTIFICATION_LIST_CLASS,
} from "@/components/navbar/dropdownStyles";

interface AdminCharacter {
  id: string;
  name: string;
  countryId: string;
  party: string | null;
  isActive: boolean;
}

interface ImperialCharacterNav {
  id: string;
  name: string;
  countryId: string;
  royalHouse: string;
}

interface NavbarProps {
  user?: {
    username: string;
    isAdmin?: boolean;
    isModerator?: boolean;
    canSeeCampaignManager?: boolean;
    patreonTier?: string | null;
    isPatronActive?: boolean;
  };
  showProfile?: boolean;
  homeState?: {
    id: string;
    name: string;
    countryId: string;
  };
  currentParty?: {
    id: string;
    name: string;
    countryId: string;
  };
  activeElection?: {
    id: string;
    seatId?: string;
    label: string;
  };
  cabinetOffice?: {
    positionId: string;
    positionName: string;
    countryCode: string;
  };
  governorOffice?: {
    stateId: string;
    stateName: string;
    countryCode: string;
  };
  activePresidentElectionId?: string;
  activePresidentElectionSeatId?: string;
  unreadCount?: number;
  myCorporationId?: number | null;
  onOpenFeedback?: () => void;
  feedbackCapturing?: boolean;
  adminCharacters?: AdminCharacter[];
  imperialCharacter?: ImperialCharacterNav;
  isImperialMode?: boolean;
  wikiDisabled?: boolean;
  conflictsEnabled?: boolean;
  unionsEnabled?: boolean;
  initialPageCountry?: CountryId | null;
}

function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export const Navbar = React.memo(function Navbar({
  user,
  showProfile = false,
  homeState,
  currentParty,
  activeElection,
  cabinetOffice,
  governorOffice,
  activePresidentElectionId,
  activePresidentElectionSeatId,
  unreadCount = 0,
  myCorporationId = null,
  onOpenFeedback,
  feedbackCapturing = false,
  adminCharacters,
  imperialCharacter,
  isImperialMode = false,
  wikiDisabled = false,
  conflictsEnabled = false,
  unionsEnabled = false,
  initialPageCountry,
}: NavbarProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  // State managed by useNavbarState reducer. Destructured to preserve the
  // legacy variable names so the rest of this 1300+ line component reads as
  // before — only setters change to `dispatch(...)` calls.
  const [navState, dispatch] = useNavbarState();
  const {
    mobileMenuOpen,
    stateOpen,
    nationOpen,
    worldOpen,
    helpOpen,
    profileOpen,
    staffOpen,
    switchingCharacter,
    switchingImperial,
    searchOpen,
    notifOpen,
    notifPreviews,
  } = navState;
  // Active charters for the mobile-menu /charters entry — gated the same
  // way as NationDropdown's desktop entry. Fetches when the hamburger
  // opens (desktop uses its own gate via the same hook).
  const mobileActiveCharters = useActiveCharters(mobileMenuOpen);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notifDropdownRef = useRef<HTMLDivElement>(null);

  // Derive country context from URL, path, or the server-resolved page country.
  const { pageCountry, userCountry, isUKContext } = useCountryContext(
    homeState?.id,
    homeState?.countryId,
    initialPageCountry
  );
  const countryName = useCountryDisplayName();
  // Mobile Referendums link gate — fetched only while the hamburger is open.
  const hasActiveReferendumCampaign = useActiveReferendumCampaign(
    pageCountry as CountryId,
    mobileMenuOpen
  );
  const stateLegislatureLabel = (() => {
    const id = homeState?.id;
    if (!isUKContext) return t("state.legislature");
    const nation = UK_NATIONS.find((n) => n.id === id);
    if (nation?.devolvedBody) return nation.devolvedBody;
    const region = UK_REGIONS.find((r) => r.id === id);
    const parentNation = UK_NATIONS.find((n) => n.id === region?.nationId);
    return parentNation?.devolvedBody ?? t("state.legislature");
  })();

  const stateAdjective = (() => {
    const id = homeState?.id;
    if (!isUKContext) return homeState?.name;
    const region = UK_REGIONS.find((r) => r.id === id);
    return region?.adjective ?? homeState?.name;
  })();
  const currentPartyCountry = currentParty?.countryId ?? pageCountry;

  // Close the mobile menu automatically once screenshot capture finishes
  const prevCapturing = useRef(false);
  useEffect(() => {
    if (prevCapturing.current && !feedbackCapturing) {
      dispatch({ type: "SET_MOBILE_MENU", open: false });
    }
    prevCapturing.current = feedbackCapturing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackCapturing]);

  // Close profile dropdown on click outside (desktop only).
  // `click` event instead of `mousedown` so the toggle button's own handler
  // fires first — otherwise the toggle and the close would race.
  useClickOutside(
    profileDropdownRef,
    profileOpen,
    () => dispatch({ type: "CLOSE_DROPDOWN", key: "profile" }),
    {
      eventType: "click",
      closeOnEscape: true,
    }
  );

  // Close search on click outside
  useClickOutside(
    searchContainerRef,
    searchOpen,
    () => dispatch({ type: "SET_POPOVER", key: "search", open: false }),
    {
      closeOnEscape: true,
    }
  );

  // Close notification dropdown on click outside
  useClickOutside(notifDropdownRef, notifOpen, () =>
    dispatch({ type: "SET_POPOVER", key: "notif", open: false })
  );

  // Fetch recent notifications when dropdown opens
  useEffect(() => {
    if (!notifOpen) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchJson<any>("/api/notifications?limit=5&offset=0", { feature: "navbar-notifications" })
      .then((data) => {
        if (data?.notifications)
          dispatch({ type: "SET_NOTIF_PREVIEWS", items: data.notifications.slice(0, 5) });
      })
      // Preview-only dropdown; fetchJson already reported any 5xx/network fault,
      // so a failure just leaves the previews empty.
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifOpen]);

  const markNotifRead = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    dispatch({ type: "MARK_PREVIEW_READ", id });
  };

  const deleteNotif = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    dispatch({ type: "REMOVE_PREVIEW", id });
  };

  const handleSwitchCharacter = useCallback(
    async (characterId: string) => {
      if (switchingCharacter) return;
      dispatch({ type: "SET_SWITCHING", key: "character", value: true });
      try {
        const res = await fetch("/api/auth/active-character", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId }),
        });
        if (res.ok) {
          window.location.reload();
        } else {
          // Defensive parse of the error body; surfaced via console.error below.
          const data = await res.json().catch(() => ({}));
          console.error("Switch character failed:", res.status, data);
        }
      } catch (e) {
        console.error("Switch character error:", e);
      } finally {
        dispatch({ type: "SET_SWITCHING", key: "character", value: false });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchingCharacter]
  );

  const handleSwitchImperial = useCallback(
    async (type: "character" | "imperial") => {
      if (switchingImperial) return;
      dispatch({ type: "SET_SWITCHING", key: "imperial", value: true });
      try {
        const res = await fetch("/api/imperial-characters/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        if (res.ok) {
          window.location.reload();
        } else {
          // Defensive parse of the error body; surfaced via console.error below.
          const data = await res.json().catch(() => ({}));
          console.error("Switch imperial failed:", res.status, data);
        }
      } catch (e) {
        console.error("Switch imperial error:", e);
      } finally {
        dispatch({ type: "SET_SWITCHING", key: "imperial", value: false });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchingImperial]
  );

  const handleSignOut = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (res.ok) window.location.assign("/");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const closeMobileMenu = () => {
    dispatch({ type: "SET_MOBILE_MENU", open: false });
    dispatch({ type: "CLOSE_ALL_DROPDOWNS" });
  };

  return (
    <nav
      className="ahd-navbar-enter sticky top-0 z-50 border-b border-card-border/60 bg-card/50 shadow-panel backdrop-blur-xl"
      aria-label={t("common.mainNavigation")}
      data-feedback-ignore="true"
    >
      {/* Top accent line: see NavbarTopFlair (fixed strip while client-nav loads + reveal) */}
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 relative">
        {/* Logo */}
        <Link
          href="/profile"
          className="flex items-center gap-2 transition-opacity hover:opacity-80 shrink-0"
          onClick={closeMobileMenu}
        >
          <Image
            src={CDN_LOGO_URL}
            unoptimized
            alt="A House Divided Logo"
            width={36}
            height={36}
            className="object-contain shrink-0"
          />
          {/* Site name fades on sub-md displays when search is open so the search field can slide over it */}
          <span
            className={`text-base font-semibold tracking-tight hidden sm:inline transition-opacity duration-300 ${searchOpen ? "opacity-0 md:opacity-100" : "opacity-100"}`}
            aria-hidden={searchOpen ? "true" : undefined}
          >
            A House Divided
          </span>
        </Link>

        {/* Right-aligned group — dropdowns + icon cluster stay tight together so justify-between only gaps logo↔group */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Desktop dropdowns — fade out when search overlay is expanded */}
          <div
            className={`hidden items-center gap-2 md:flex shrink-0 transition-opacity duration-200 ${searchOpen ? "opacity-0 pointer-events-none" : "opacity-100"}`}
            aria-hidden={searchOpen ? "true" : undefined}
          >
            {showProfile &&
            ((adminCharacters && adminCharacters.length > 1) || imperialCharacter) ? (
              <div className="relative" ref={profileDropdownRef}>
                <button
                  onClick={() => dispatch({ type: "TOGGLE_DROPDOWN", key: "profile" })}
                  className={`relative flex items-center gap-1 px-2.5 py-1 text-sm transition-colors hover:text-foreground ${isNavActive(pathname, "/profile") ? "font-medium text-foreground after:absolute after:bottom-0 after:left-1 after:right-1 after:h-px after:rounded-full after:bg-primary after:opacity-70" : "text-muted"}`}
                  aria-expanded={profileOpen}
                  aria-haspopup="menu"
                >
                  {isImperialMode
                    ? (imperialCharacter?.name ?? t("common.imperial"))
                    : (adminCharacters?.find((c) => c.isActive)?.name ?? t("common.profile"))}
                  <svg
                    className={`h-4 w-4 shrink-0 transition-transform duration-200 ${profileOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {profileOpen && (
                  <div className="absolute left-0 z-50 mt-2 w-52 rounded-xl border border-card-border bg-card shadow-modal overflow-hidden">
                    <div className="py-1">
                      {adminCharacters?.map((char) =>
                        char.isActive && !isImperialMode ? (
                          <Link
                            key={char.id}
                            href="/profile"
                            onClick={() => dispatch({ type: "CLOSE_DROPDOWN", key: "profile" })}
                            className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background/60"
                          >
                            <span className="truncate">{char.name}</span>
                            <span className="shrink-0 flex items-center gap-1.5 text-xs">
                              <span className="text-muted/60">{char.countryId}</span>
                              <span className="text-primary font-medium">{t("common.active")}</span>
                            </span>
                          </Link>
                        ) : isImperialMode ? (
                          <button
                            key={char.id}
                            onClick={() => {
                              dispatch({ type: "CLOSE_DROPDOWN", key: "profile" });
                              handleSwitchImperial("character");
                            }}
                            disabled={switchingImperial}
                            className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-sm text-muted transition-colors hover:bg-background/60 hover:text-foreground disabled:opacity-50"
                          >
                            <span className="truncate">{char.name}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted/60">
                              {char.countryId}
                            </span>
                          </button>
                        ) : (
                          <a
                            key={char.id}
                            href={`/api/auth/active-character?switch=${char.id}`}
                            className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-sm text-muted transition-colors hover:bg-background/60 hover:text-foreground"
                          >
                            <span className="truncate">{char.name}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted/60">
                              {char.countryId}
                            </span>
                          </a>
                        )
                      )}
                      {imperialCharacter && (
                        <>
                          <div className="border-t border-card-border/40 my-1" />
                          {isImperialMode ? (
                            <Link
                              href={`/imperial/${imperialCharacter.id}`}
                              onClick={() => dispatch({ type: "CLOSE_DROPDOWN", key: "profile" })}
                              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background/60"
                            >
                              <span className="truncate">{imperialCharacter.name}</span>
                              <span className="shrink-0 flex items-center gap-1.5 text-xs">
                                <span className="text-amber-400/70">{t("common.imperial")}</span>
                                <span className="text-primary font-medium">
                                  {t("common.active")}
                                </span>
                              </span>
                            </Link>
                          ) : (
                            <button
                              onClick={() => {
                                dispatch({ type: "CLOSE_DROPDOWN", key: "profile" });
                                handleSwitchImperial("imperial");
                              }}
                              disabled={switchingImperial}
                              className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-sm text-muted transition-colors hover:bg-background/60 hover:text-foreground disabled:opacity-50"
                            >
                              <span className="truncate">{imperialCharacter.name}</span>
                              <span className="ml-auto shrink-0 text-xs text-amber-400/70">
                                {t("common.imperial")}
                              </span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              showProfile && (
                <Link
                  href="/profile"
                  className={`relative px-2.5 py-1 text-sm transition-colors hover:text-foreground ${isNavActive(pathname, "/profile") ? "font-medium text-foreground after:absolute after:bottom-0 after:left-1 after:right-1 after:h-px after:rounded-full after:bg-primary after:opacity-70" : "text-muted"}`}
                  aria-current={isNavActive(pathname, "/profile") ? "page" : undefined}
                >
                  {t("common.profile")}
                </Link>
              )
            )}

            {showProfile && !isImperialMode && (
              <Link
                href="/actions"
                data-coach="nav-actions"
                className={`relative px-2.5 py-1 text-sm transition-colors hover:text-foreground ${isNavActive(pathname, "/actions") ? "font-medium text-foreground after:absolute after:bottom-0 after:left-1 after:right-1 after:h-px after:rounded-full after:bg-primary after:opacity-70" : "text-muted"}`}
                aria-current={isNavActive(pathname, "/actions") ? "page" : undefined}
              >
                {t("common.actions")}
              </Link>
            )}

            {homeState && (
              <StateDropdown
                stateId={homeState.id}
                stateName={homeState.name}
                countryId={homeState.countryId}
                currentParty={currentParty}
                activeElection={activeElection}
                cabinetOffice={cabinetOffice}
                governorOffice={governorOffice}
              />
            )}

            {showProfile && (
              <NationDropdown
                currentParty={currentParty}
                cabinetOffice={cabinetOffice}
                activePresidentElectionId={activePresidentElectionId}
                activePresidentElectionSeatId={activePresidentElectionSeatId}
                isUKContext={isUKContext}
                countryId={pageCountry}
                userCountry={userCountry}
                unionsEnabled={unionsEnabled}
              />
            )}

            {showProfile && (
              <WorldDropdown
                isUKContext={isUKContext}
                countryId={pageCountry}
                myCorporationId={myCorporationId}
                conflictsEnabled={conflictsEnabled}
                unionsEnabled={unionsEnabled}
              />
            )}

            <HelpDropdown
              onOpenFeedback={onOpenFeedback}
              feedbackCapturing={feedbackCapturing}
              wikiDisabled={wikiDisabled}
              isAdminOrMod={!!(user?.isAdmin || user?.isModerator)}
            />

            <StaffDropdown isAdmin={!!user?.isAdmin} isModerator={!!user?.isModerator} />
          </div>

          {/* Search + icon cluster */}
          <div className="flex items-center gap-1 shrink-0 relative">
            {/* Search input — absolutely positioned so it grows leftward without displacing icons */}
            <div
              ref={searchContainerRef}
              className={`absolute right-full top-1/2 -translate-y-1/2 mr-1 overflow-hidden transition-all duration-300 ease-out ${
                searchOpen
                  ? "w-[min(calc(100vw-9rem),20rem)] sm:w-[20rem] md:w-[26rem] lg:w-[30rem] opacity-100"
                  : "w-0 opacity-0"
              }`}
              style={{ pointerEvents: searchOpen ? "auto" : "none" }}
            >
              <UniversalSearch open={searchOpen} />
            </div>

            <button
              onClick={() => dispatch({ type: "SET_POPOVER", key: "search", open: !searchOpen })}
              className={`relative flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-card hover:text-foreground ${searchOpen ? "text-foreground bg-card" : "text-muted"}`}
              aria-label={t("common.search")}
              aria-expanded={searchOpen}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </button>

            {showProfile && (
              <Link
                href="/portfolio?tab=currency"
                className={`relative flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-card hover:text-foreground ${isNavActive(pathname, "/portfolio") ? "text-foreground" : "text-muted"}`}
                aria-label={t("common.wallet")}
                aria-current={isNavActive(pathname, "/portfolio") ? "page" : undefined}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                  />
                </svg>
              </Link>
            )}

            {showProfile && (
              <div className="relative" ref={notifDropdownRef}>
                <button
                  onClick={() => dispatch({ type: "SET_POPOVER", key: "notif", open: !notifOpen })}
                  className={`relative flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-card hover:text-foreground ${isNavActive(pathname, "/notifications") ? "text-foreground" : "text-muted"} ${notifPreviews.some((n) => !n.read && isActionRequiredType(n.type as NotificationType)) ? "ahd-bell-pulse" : ""}`}
                  aria-label={
                    unreadCount > 0
                      ? t("notifications.ariaUnread", { count: unreadCount })
                      : t("common.notifications")
                  }
                  aria-expanded={notifOpen}
                  aria-haspopup="menu"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                  {unreadCount > 0 && (
                    <span
                      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card"
                      aria-hidden
                    />
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-card-border bg-card shadow-modal overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
                      <span className="text-sm font-semibold">{t("common.notifications")}</span>
                      <Link
                        href="/notifications"
                        onClick={() => dispatch({ type: "SET_POPOVER", key: "notif", open: false })}
                        className="text-xs text-primary hover:text-primary/80 transition-colors"
                      >
                        {t("notifications.openInbox")}
                      </Link>
                    </div>
                    {notifPreviews.some(
                      (n) => !n.read && isActionRequiredType(n.type as NotificationType)
                    ) && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-card-border">
                        <span className="ahd-bell-pulse h-2 w-2 shrink-0 rounded-full bg-primary" />
                        <span className="text-xs text-fg-2">
                          {t("notifications.awaitingInput", {
                            count: notifPreviews.filter(
                              (n) => !n.read && isActionRequiredType(n.type as NotificationType)
                            ).length,
                          })}
                        </span>
                      </div>
                    )}
                    <div className={`py-1 ${NOTIFICATION_LIST_CLASS}`}>
                      {notifPreviews.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-muted">
                          {t("notifications.empty")}
                        </p>
                      ) : (
                        [...notifPreviews]
                          .sort(
                            (a, b) =>
                              Number(!b.read && isActionRequiredType(b.type as NotificationType)) -
                              Number(!a.read && isActionRequiredType(a.type as NotificationType))
                          )
                          .map((n) => (
                            <div
                              key={n._id}
                              className={`group flex items-start gap-2 px-4 py-3 text-sm transition-colors hover:bg-card-elevated ${n.read ? "opacity-60" : ""}`}
                            >
                              {!n.read && (
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                              )}
                              <Link
                                href="/notifications"
                                onClick={() =>
                                  dispatch({ type: "SET_POPOVER", key: "notif", open: false })
                                }
                                className="flex-1 min-w-0"
                              >
                                {!n.read && isActionRequiredType(n.type as NotificationType) && (
                                  <span className="mb-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary bg-primary/10">
                                    {t("notifications.needsYou")}
                                  </span>
                                )}
                                <p
                                  className={`font-medium truncate ${n.read ? "text-muted" : "text-foreground"}`}
                                >
                                  {n.title}
                                </p>
                                <p className="text-xs text-muted line-clamp-1 mt-0.5">
                                  {n.message}
                                </p>
                              </Link>
                              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                {!n.read && (
                                  <button
                                    onClick={(e) => markNotifRead(n._id, e)}
                                    className="p-1 rounded text-muted hover:text-foreground hover:bg-card-muted transition-colors"
                                    title={t("notifications.markRead")}
                                  >
                                    <svg
                                      className="h-3.5 w-3.5"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  </button>
                                )}
                                <button
                                  onClick={(e) => deleteNotif(n._id, e)}
                                  className="p-1 rounded text-muted hover:text-error hover:bg-card-muted transition-colors"
                                  title={t("notifications.delete")}
                                >
                                  <svg
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Settings gear — visible on both desktop and mobile so the
                country/nation toggle is reachable without opening the
                hamburger menu. */}
            {user && (
              <SettingsDropdown
                user={user}
                onSignOut={handleSignOut}
                pageCountry={pageCountry}
                userCountry={userCountry}
              />
            )}

            {!user && (
              <div className="hidden md:flex items-center gap-2">
                <Link
                  href="/login"
                  className="text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  {t("common.signIn")}
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-3.5 h-9 text-sm font-semibold text-white transition-all duration-150 hover:bg-primary-dark active:scale-[0.98]"
                >
                  {t("common.register")}
                </Link>
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
              onClick={() => dispatch({ type: "SET_MOBILE_MENU", open: !mobileMenuOpen })}
              aria-label={mobileMenuOpen ? t("common.closeMenu") : t("common.openMenu")}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-menu"
            >
              {mobileMenuOpen ? (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu panel — top to bottom, sections collapsed by default */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-menu"
          className={`border-t border-card-border/60 bg-card/70 backdrop-blur-xl md:hidden ${MOBILE_MENU_PANEL_CLASS}`}
        >
          <div className="mx-auto max-w-7xl space-y-0.5 px-4 py-3">
            {/* Standard Nav Items */}
            {/* Profile */}
            {showProfile &&
            ((adminCharacters && adminCharacters.length > 1) || imperialCharacter) ? (
              <div>
                <button
                  onClick={() => dispatch({ type: "TOGGLE_DROPDOWN", key: "profile" })}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
                  aria-expanded={profileOpen}
                >
                  {isImperialMode
                    ? (imperialCharacter?.name ?? t("common.imperial"))
                    : (adminCharacters?.find((c) => c.isActive)?.name ?? t("common.profile"))}
                  <ChevronIcon open={profileOpen} />
                </button>
                {profileOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
                    {adminCharacters?.map((char) =>
                      char.isActive && !isImperialMode ? (
                        <Link
                          key={char.id}
                          href="/profile"
                          onClick={closeMobileMenu}
                          className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, "/profile") ? "bg-white/5 font-medium" : "text-foreground"}`}
                        >
                          <span>{char.name}</span>
                          <span className="text-xs text-primary font-medium">
                            {t("common.active")}
                          </span>
                        </Link>
                      ) : isImperialMode ? (
                        <button
                          key={char.id}
                          onClick={() => handleSwitchImperial("character")}
                          disabled={switchingImperial}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5 disabled:opacity-50"
                        >
                          <span>{char.name}</span>
                          <span className="text-xs text-muted/60">{char.countryId}</span>
                        </button>
                      ) : (
                        <button
                          key={char.id}
                          onClick={() => handleSwitchCharacter(char.id)}
                          disabled={switchingCharacter}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5 disabled:opacity-50"
                        >
                          <span>{char.name}</span>
                          <span className="text-xs text-muted/60">{char.countryId}</span>
                        </button>
                      )
                    )}
                    {imperialCharacter && (
                      <>
                        <div className="border-t border-card-border/40 my-1" />
                        {isImperialMode ? (
                          <Link
                            href={`/imperial/${imperialCharacter.id}`}
                            onClick={closeMobileMenu}
                            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 text-foreground"
                          >
                            <span>{imperialCharacter.name}</span>
                            <span className="flex items-center gap-1.5 text-xs">
                              <span className="text-amber-400/70">{t("common.imperial")}</span>
                              <span className="text-primary font-medium">{t("common.active")}</span>
                            </span>
                          </Link>
                        ) : (
                          <button
                            onClick={() => handleSwitchImperial("imperial")}
                            disabled={switchingImperial}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5 disabled:opacity-50"
                          >
                            <span>{imperialCharacter.name}</span>
                            <span className="text-xs text-amber-400/70">
                              {t("common.imperial")}
                            </span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              showProfile && (
                <Link
                  href="/profile"
                  onClick={closeMobileMenu}
                  className={`flex items-center rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, "/profile") ? "bg-white/5 font-medium text-foreground" : "text-foreground"}`}
                  aria-current={isNavActive(pathname, "/profile") ? "page" : undefined}
                >
                  {t("common.profile")}
                </Link>
              )
            )}

            {/* Actions — hidden for imperial characters */}
            {showProfile && !isImperialMode && (
              <Link
                href="/actions"
                onClick={closeMobileMenu}
                className={`flex items-center rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, "/actions") ? "bg-white/5 font-medium" : ""}`}
                aria-current={isNavActive(pathname, "/actions") ? "page" : undefined}
              >
                {t("common.actions")}
              </Link>
            )}

            {/* Staff tools — collapsible, admin/mod only. Kept OUT of the flat
                top-level list on purpose: ops/staff links live under this one
                gated "Staff" section, never as headlining tabs. */}
            {(user?.isAdmin || user?.isModerator) &&
              (() => {
                const staffItems = visibleStaffNavItems({
                  isAdmin: !!user?.isAdmin,
                  isModerator: !!user?.isModerator,
                });
                if (staffItems.length === 0) return null;
                return (
                  <div>
                    <button
                      onClick={() => dispatch({ type: "TOGGLE_DROPDOWN", key: "staff" })}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
                      aria-expanded={staffOpen}
                    >
                      <span className="flex items-center gap-2">
                        <svg
                          className="h-4 w-4 text-muted"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                        {t("common.staff")}
                      </span>
                      <ChevronIcon open={staffOpen} />
                    </button>
                    {staffOpen && (
                      <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
                        {staffItems.map((i) =>
                          i.external ? (
                            <a
                              key={i.label}
                              href={i.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={closeMobileMenu}
                              className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                            >
                              {t(i.labelKey)}
                            </a>
                          ) : (
                            <Link
                              key={i.label}
                              href={i.href}
                              onClick={closeMobileMenu}
                              className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, i.href) ? "bg-white/5 font-medium" : "text-muted"}`}
                              aria-current={isNavActive(pathname, i.href) ? "page" : undefined}
                            >
                              {t(i.labelKey)}
                            </Link>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

            {/* State section — collapsible, collapsed by default */}
            {homeState && (
              <div>
                <button
                  onClick={() => dispatch({ type: "TOGGLE_DROPDOWN", key: "state" })}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
                  aria-expanded={stateOpen}
                >
                  {homeState.name}
                  <ChevronIcon open={stateOpen} />
                </button>
                {stateOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
                    <Link
                      href={regionUrl(homeState.countryId, homeState.id)}
                      onClick={closeMobileMenu}
                      className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, regionUrl(homeState.countryId, homeState.id)) ? "bg-white/5 font-medium" : "text-muted"}`}
                      aria-current={
                        isNavActive(pathname, regionUrl(homeState.countryId, homeState.id))
                          ? "page"
                          : undefined
                      }
                    >
                      {t("state.overview")}
                    </Link>
                    {currentParty && (
                      <Link
                        href={regionPartyUrl(homeState.countryId, homeState.id, currentParty.id)}
                        onClick={closeMobileMenu}
                        className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, regionPartyUrl(homeState.countryId, homeState.id, currentParty.id)) ? "bg-white/5 font-medium" : "text-muted"}`}
                      >
                        {stateAdjective} {currentParty.name}
                      </Link>
                    )}
                    <Link
                      href={`${regionUrl(homeState.countryId, homeState.id)}?tab=economy`}
                      onClick={closeMobileMenu}
                      className="flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 text-muted"
                    >
                      {t("state.economy")}
                    </Link>
                    <Link
                      href={regionElectionsUrl(homeState.countryId, homeState.id)}
                      onClick={closeMobileMenu}
                      className="flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 text-muted"
                    >
                      {t("state.elections")}
                    </Link>
                    <Link
                      href={regionLegislatureUrl(homeState.countryId, homeState.id)}
                      onClick={closeMobileMenu}
                      className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, regionLegislatureUrl(homeState.countryId, homeState.id)) ? "bg-white/5 font-medium" : "text-muted"}`}
                    >
                      {stateLegislatureLabel}
                    </Link>
                    {governorOffice && governorOffice.stateId === homeState.id && (
                      <Link
                        href={`/country/${homeState.countryId.toLowerCase()}/region/${homeState.id.toLowerCase()}/office`}
                        onClick={closeMobileMenu}
                        className="flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 text-muted"
                      >
                        {t("state.office")}
                      </Link>
                    )}
                    {activeElection ? (
                      <Link
                        href={`/elections/${activeElection.seatId ?? activeElection.id}`}
                        onClick={closeMobileMenu}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, `/elections/${activeElection.seatId ?? activeElection.id}`) ? "bg-white/5 font-medium" : "text-muted"}`}
                        aria-current={
                          isNavActive(
                            pathname,
                            `/elections/${activeElection.seatId ?? activeElection.id}`
                          )
                            ? "page"
                            : undefined
                        }
                      >
                        <span>{t("state.myElection")}</span>
                        <span className="ml-2 max-w-[120px] truncate text-xs text-muted">
                          {activeElection.label}
                        </span>
                      </Link>
                    ) : (
                      <div className="flex items-center rounded-lg px-3 py-2 text-sm text-muted opacity-50">
                        {t("state.myElectionNone")}
                      </div>
                    )}
                    {cabinetOffice && (
                      <Link
                        href={`/country/${cabinetOffice.countryCode}/executive/cabinet/${cabinetOffice.positionId}`}
                        onClick={closeMobileMenu}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, `/country/${cabinetOffice.countryCode}/executive/cabinet/${cabinetOffice.positionId}`) ? "bg-white/5 font-medium" : "text-muted"}`}
                      >
                        <span>{t("state.myOffice")}</span>
                        <span className="ml-2 max-w-[120px] truncate text-xs text-muted">
                          {cabinetOffice.positionName}
                        </span>
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* The Nation section — collapsible, collapsed by default */}
            {showProfile && (
              <div>
                <button
                  onClick={() => dispatch({ type: "TOGGLE_DROPDOWN", key: "nation" })}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
                  aria-expanded={nationOpen}
                >
                  <div className="flex items-center gap-2">
                    <CountryFlag country={pageCountry} size="md" className="shrink-0" />
                    <span>{countryName(pageCountry)}</span>
                  </div>
                  <ChevronIcon open={nationOpen} />
                </button>
                {nationOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
                    {/* Home Nation */}
                    <Link
                      href={countryUrl(userCountry)}
                      onClick={closeMobileMenu}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                    >
                      <CountryFlag country={userCountry} size="sm" />
                      <span>{countryName(userCountry)}</span>
                      <span className="text-xs text-muted/60">{t("menus.nation.homeSuffix")}</span>
                    </Link>

                    {cabinetOffice && (
                      <Link
                        href={`/country/${cabinetOffice.countryCode}/executive/cabinet/${cabinetOffice.positionId}/office`}
                        onClick={closeMobileMenu}
                        className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, `/country/${cabinetOffice.countryCode}/executive/cabinet/${cabinetOffice.positionId}/office`) ? "bg-white/5 font-medium" : "text-muted"}`}
                      >
                        {t("menus.nation.cabinetOffice")} · {cabinetOffice.positionName}
                      </Link>
                    )}

                    {currentParty && (
                      <Link
                        href={partyUrl(currentPartyCountry, currentParty.id)}
                        onClick={closeMobileMenu}
                        className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, partyUrl(currentPartyCountry, currentParty.id)) ? "bg-white/5 font-medium" : "text-muted"}`}
                        aria-current={
                          isNavActive(pathname, partyUrl(currentPartyCountry, currentParty.id))
                            ? "page"
                            : undefined
                        }
                      >
                        {t("menus.nation.myParty")} · {currentParty.name}
                      </Link>
                    )}

                    {userCountry === "US" && (
                      <Link
                        href="/political-operations"
                        onClick={closeMobileMenu}
                        className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, "/political-operations") ? "bg-white/5 font-medium" : "text-muted"}`}
                        aria-current={
                          isNavActive(pathname, "/political-operations") ? "page" : undefined
                        }
                      >
                        {t("menus.nation.myPoliticalOperations")}
                      </Link>
                    )}

                    <div className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted/60">
                      {t("menus.nation.nationalDetailsFor", {
                        country: countryName(pageCountry),
                      })}
                    </div>

                    <MobileNationalDetails
                      countryId={pageCountry as CountryId}
                      onNavigate={closeMobileMenu}
                      activePresidentElection={
                        activePresidentElectionId
                          ? {
                              id: activePresidentElectionId,
                              seatId: activePresidentElectionSeatId,
                            }
                          : null
                      }
                      charters={
                        mobileActiveCharters && mobileActiveCharters.length > 0
                          ? {
                              href:
                                mobileActiveCharters.length === 1
                                  ? `/charters/${mobileActiveCharters[0]!.id}`
                                  : "/charters",
                              label:
                                mobileActiveCharters.length === 1
                                  ? t("menus.nation.charterSingle", {
                                      name: mobileActiveCharters[0]!.proposedName,
                                    })
                                  : t("menus.nation.chartersMultiple", {
                                      count: mobileActiveCharters.length,
                                    }),
                            }
                          : null
                      }
                      hasActiveReferendumCampaign={hasActiveReferendumCampaign}
                      unionsEnabled={unionsEnabled}
                    />
                  </div>
                )}
              </div>
            )}

            {/* World section — collapsible, collapsed by default */}
            {showProfile && (
              <div>
                <button
                  onClick={() => dispatch({ type: "TOGGLE_DROPDOWN", key: "world" })}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
                  aria-expanded={worldOpen}
                >
                  {t("common.world")}
                  <ChevronIcon open={worldOpen} />
                </button>
                {worldOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
                    {visibleWorldNavItems({
                      countryId: pageCountry,
                      myCorporationId,
                      conflictsEnabled,
                      unionsEnabled,
                    }).map((item) => (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={closeMobileMenu}
                        className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${
                          item.primary
                            ? isNavActive(pathname, item.href)
                              ? "bg-white/5 font-medium"
                              : "text-primary"
                            : isNavActive(pathname, item.href) ||
                                (item.id === "stockMarket" && pathname.includes("/stockmarket")) ||
                                (item.id === "forex" && pathname.includes("/forex"))
                              ? "bg-white/5 font-medium"
                              : "text-muted"
                        }`}
                        aria-current={
                          isNavActive(pathname, item.href) ||
                          (item.id === "stockMarket" && pathname.includes("/stockmarket")) ||
                          (item.id === "forex" && pathname.includes("/forex"))
                            ? "page"
                            : undefined
                        }
                      >
                        {t(item.labelKey)}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Help/Information section — collapsible, collapsed by default */}
            <div>
              <button
                onClick={() => dispatch({ type: "TOGGLE_DROPDOWN", key: "help" })}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
                aria-expanded={helpOpen}
              >
                {t("help.helpInformation")}
                <ChevronIcon open={helpOpen} />
              </button>
              {helpOpen && (
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
                  {(() => {
                    const showWiki = !!(user?.isAdmin || user?.isModerator) || !wikiDisabled;
                    const wikiHref = showWiki ? "/wiki" : "/guides";
                    const wikiActive = showWiki
                      ? isNavActive(pathname, "/wiki") || isNavActive(pathname, "/guides")
                      : isNavActive(pathname, "/guides");
                    return (
                      <Link
                        href={wikiHref}
                        onClick={closeMobileMenu}
                        className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${wikiActive ? "bg-white/5 font-medium" : "text-muted"}`}
                        aria-current={wikiActive ? "page" : undefined}
                      >
                        {showWiki ? t("help.wikiGuides") : t("help.guides")}
                      </Link>
                    );
                  })()}
                  <Link
                    href="/about"
                    onClick={closeMobileMenu}
                    className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, "/about") ? "bg-white/5 font-medium" : "text-muted"}`}
                    aria-current={isNavActive(pathname, "/about") ? "page" : undefined}
                  >
                    {t("help.about")}
                  </Link>
                  <Link
                    href="/feedback"
                    onClick={closeMobileMenu}
                    className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, "/feedback") ? "bg-white/5 font-medium text-foreground" : "text-muted"}`}
                    aria-current={isNavActive(pathname, "/feedback") ? "page" : undefined}
                  >
                    {t("help.suggestions")}
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      closeMobileMenu();
                      onOpenFeedback?.();
                    }}
                    disabled={feedbackCapturing}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-white/5 disabled:cursor-wait disabled:opacity-70"
                  >
                    {feedbackCapturing && (
                      <svg
                        className="h-4 w-4 shrink-0 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                    )}
                    {feedbackCapturing ? t("common.capturingScreenshot") : t("common.quickSuggest")}
                  </button>
                  <a
                    href={HELP_DISCORD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeMobileMenu}
                    className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                  >
                    Discord
                  </a>
                  <a
                    href={HELP_PATREON_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeMobileMenu}
                    className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                  >
                    {t("help.patreon")}
                  </a>
                  <a
                    href={HELP_SUPPORTER_WALL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeMobileMenu}
                    className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                  >
                    {t("help.supporterWall")}
                  </a>
                  <a
                    href={HELP_SUPPORT_EMAIL}
                    onClick={closeMobileMenu}
                    className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                  >
                    {t("help.emailSupport")}
                  </a>
                  <a
                    href={HELP_STATUS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeMobileMenu}
                    className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                  >
                    {t("help.serverStatus")}
                  </a>
                  <div className="my-1 border-t border-card-border/60" />
                  <Link
                    href="/privacy"
                    onClick={closeMobileMenu}
                    className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, "/privacy") ? "bg-white/5 font-medium text-foreground" : "text-muted"}`}
                    aria-current={isNavActive(pathname, "/privacy") ? "page" : undefined}
                  >
                    {t("help.privacy")}
                  </Link>
                  <Link
                    href="/terms"
                    onClick={closeMobileMenu}
                    className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${isNavActive(pathname, "/terms") ? "bg-white/5 font-medium text-foreground" : "text-muted"}`}
                    aria-current={isNavActive(pathname, "/terms") ? "page" : undefined}
                  >
                    {t("help.terms")}
                  </Link>
                </div>
              )}
            </div>
          </div>

          {!user && (
            <div className="border-t border-card-border/40 px-4 py-4 flex flex-col gap-2">
              <Link
                href="/login"
                onClick={closeMobileMenu}
                className="flex items-center justify-center rounded-lg border border-card-border bg-card py-2.5 text-sm font-medium text-foreground"
              >
                {t("common.signIn")}
              </Link>
              <Link
                href="/register"
                onClick={closeMobileMenu}
                className="flex items-center justify-center rounded-lg bg-primary py-2.5 text-sm font-semibold text-white"
              >
                {t("common.register")}
              </Link>
            </div>
          )}

          {/* Version footer */}
          <Link
            href="/changelog"
            onClick={closeMobileMenu}
            className="flex items-center justify-center gap-2 border-t border-card-border/60 px-4 py-2 text-center text-xs text-muted hover:text-foreground transition-colors"
          >
            <span>
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"} ·{" "}
              {process.env.NEXT_PUBLIC_GIT_COMMIT ?? "dev"}
            </span>
            {process.env.NEXT_PUBLIC_IS_PREVIEW === "true" && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                {t("common.preview")}
              </span>
            )}
          </Link>
        </div>
      )}
    </nav>
  );
});
