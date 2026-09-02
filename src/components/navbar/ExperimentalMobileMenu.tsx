"use client";

/**
 * Mobile slide-down menu panel for {@link ExperimentalNavbar} — inline search,
 * core nav items with collapsible sub-sections (state/nation/world), the
 * nation-view switcher, help/staff sections, and the profile card. Pure
 * presentation: all open/close state lives in the navbar and is passed down.
 */

import React, { useContext } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { UniversalSearch } from "@/components/UniversalSearch";
import { Avatar } from "@/components/Avatar";
import { CountryFlag } from "@/components/CountryFlag";
import { type CountryId } from "@/lib/constants/countries";
import {
  RegisteredCountriesContext,
  getCountryDisplayNameWithOverrides,
} from "@/contexts/RegisteredCountriesContext";
import {
  countryUrl,
  partyUrl,
  regionUrl,
  regionPartyUrl,
  regionLegislatureUrl,
  regionElectionsUrl,
  cabinetOfficeUrl,
} from "@/lib/urls";
import {
  HELP_DISCORD_URL,
  HELP_PATREON_URL,
  HELP_SUPPORTER_WALL_URL,
  HELP_SUPPORT_EMAIL,
} from "@/components/HelpDropdown";
import { MobileNationalDetails } from "@/components/navbar/MobileNationalDetails";
import { CollapsibleNavSection } from "@/components/navbar/CollapsibleNavSection";
import {
  buildWorldNavSections,
  looseWorldNavItems,
  type WorldNavItem,
} from "@/components/navbar/worldNavItems";
import type { ProfileNavItem } from "@/components/navbar/profileNavItems";
import type { StaffNavItem } from "@/components/navbar/staffNavItems";
import { MOBILE_MENU_PANEL_CLASS } from "@/components/navbar/dropdownStyles";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { Chevron, NavIcon, isNavActive } from "./experimentalNavPrimitives";
import type {
  CharacterProfile,
  CharterNavEntry,
  ExperimentalNavItem,
  MobileSubKey,
  NavLinkRef,
} from "./experimentalNavTypes";

export interface ExperimentalMobileMenuProps {
  navItems: ExperimentalNavItem[];
  pathname: string;
  mobileSubOpen: Partial<Record<MobileSubKey, boolean>>;
  toggleMobileSub: (key: MobileSubKey) => void;
  /** Closes the mobile menu (parent's `setMobileMenuOpen(false)`). */
  onClose: () => void;
  user?: NavLinkRef;
  showProfile: boolean;
  characterProfile?: CharacterProfile;
  profileDisplayName: string;
  unreadCount: number;
  currentParty?: { id: string; name: string; countryId: string };
  homeState?: { id: string; name: string; countryId: string };
  activeElection?: { id: string; seatId?: string; label: string };
  cabinetOffice?: { positionId: string; positionName: string; countryCode: string };
  governorOffice?: { stateId: string; stateName: string; countryCode: string };
  stateLegislatureLabel: string;
  pageCountry: string;
  userCountry: string;
  preset: string;
  switchableCountries: CountryId[];
  worldSubItems: WorldNavItem[];
  profileOrgItems: ProfileNavItem[];
  staffSubItems: StaffNavItem[];
  charterEntry: CharterNavEntry | null;
  hasActiveReferendumCampaign: boolean;
  /** Player-run unions feature flag; gates the Economy group's Unions link. */
  unionsEnabled?: boolean;
  showWiki: boolean;
  onOpenFeedback?: () => void;
  feedbackCapturing: boolean;
  handleSignOut: () => void;
}

export function ExperimentalMobileMenu({
  navItems,
  pathname,
  mobileSubOpen,
  toggleMobileSub,
  onClose,
  user,
  showProfile,
  characterProfile,
  profileDisplayName,
  unreadCount,
  currentParty,
  homeState,
  activeElection,
  cabinetOffice,
  governorOffice,
  stateLegislatureLabel,
  pageCountry,
  userCountry,
  preset,
  switchableCountries,
  worldSubItems,
  profileOrgItems,
  staffSubItems,
  charterEntry,
  hasActiveReferendumCampaign,
  unionsEnabled = false,
  showWiki,
  onOpenFeedback,
  feedbackCapturing,
  handleSignOut,
}: ExperimentalMobileMenuProps) {
  const t = useTranslations("nav");
  // Runtime identity layer (ticket #1255): the mobile switcher rows read the
  // same override-aware names the desktop nav does.
  const { preset: ctxPreset, displayOverrides } = useContext(RegisteredCountriesContext);
  const countryName = (id: CountryId): string =>
    getCountryDisplayNameWithOverrides(id, ctxPreset ?? preset, displayOverrides);
  return (
    <div
      id="experimental-mobile-menu"
      className={`border-t border-card-border/60 bg-card/70 px-3.5 py-3.5 backdrop-blur-xl md:hidden ${MOBILE_MENU_PANEL_CLASS}`}
    >
      {/* Search — inline; no autofocus so opening the menu doesn't pop the
          keyboard / scroll-zoom into the field on mobile (focuses on tap). */}
      <div className="mb-3.5">
        <UniversalSearch />
      </div>

      {/* Profile card — top of the drawer so it's the first thing you hit. */}
      {showProfile && user && (
        <div className="mb-3.5 overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="relative">
            <div className="relative h-20 overflow-hidden">
              {characterProfile?.profileHeaderImageUrl ? (
                <Image
                  src={characterProfile.profileHeaderImageUrl}
                  alt=""
                  fill
                  className="object-cover object-center"
                  sizes="320px"
                  unoptimized={bypassNextImageOptimization(characterProfile.profileHeaderImageUrl)}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-card-elevated to-secondary/20" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/55 to-transparent" />
            </div>
            <div className="absolute left-3.5 top-20 z-10 -translate-y-1/2">
              <div className="rounded-lg border-[3px] border-card bg-card shadow-panel">
                <Avatar
                  url={characterProfile?.avatarUrl}
                  name={profileDisplayName}
                  size="h-10 w-10"
                  borderKey={characterProfile?.borderKey}
                  tintColor={characterProfile?.tintColor}
                  className="rounded-md"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 px-3.5 pb-3.5 pt-9">
              <div className="min-w-0 flex-1 pl-12">
                <div className="truncate text-sm font-semibold text-foreground">
                  {profileDisplayName}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href="/profile"
                    onClick={onClose}
                    className="text-xs text-muted transition-colors hover:text-foreground"
                  >
                    {t("common.profile")}
                  </Link>
                  <Link
                    href="/notifications"
                    onClick={onClose}
                    className="text-xs text-muted transition-colors hover:text-foreground"
                  >
                    {t("common.notifications")}
                    {unreadCount > 0 ? ` (${unreadCount > 9 ? "9+" : unreadCount})` : ""}
                  </Link>
                  <Link
                    href="/settings"
                    onClick={onClose}
                    className="text-xs text-muted transition-colors hover:text-foreground"
                  >
                    {t("common.settings")}
                  </Link>
                  <Link
                    href="/portfolio?tab=currency"
                    onClick={onClose}
                    className="text-xs text-muted transition-colors hover:text-foreground"
                  >
                    {t("common.wallet")}
                  </Link>
                  {profileOrgItems.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={onClose}
                      className="text-xs text-primary transition-colors hover:text-foreground"
                    >
                      {t(item.labelKey)}
                    </Link>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                aria-label={t("userMenu.signOutAria")}
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-card-border bg-background text-muted transition-colors hover:text-foreground"
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
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
          <Link
            href="/changelog"
            onClick={onClose}
            className="flex items-center justify-center border-t border-card-border px-4 py-2 text-center text-xs text-muted transition-colors hover:text-foreground"
          >
            v{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"} ·{" "}
            {process.env.NEXT_PUBLIC_GIT_COMMIT ?? "dev"}
          </Link>
        </div>
      )}

      {/* Core nav items */}
      <div className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const active = isNavActive(pathname, item.href);
          const subKey = item.key as MobileSubKey | undefined;
          if (subKey) {
            const isSubOpen = !!mobileSubOpen[subKey];
            return (
              <div key={item.label}>
                <button
                  type="button"
                  onClick={() => toggleMobileSub(subKey)}
                  aria-expanded={isSubOpen}
                  className={`flex w-full items-center gap-3 rounded-[10px] px-3.5 py-3 text-[15px] transition-colors hover:bg-white/5 ${
                    active || isSubOpen ? "bg-card font-semibold text-foreground" : "text-fg-2"
                  }`}
                >
                  <NavIcon name={item.icon} className="h-[18px] w-[18px]" />
                  {item.label}
                  <Chevron open={isSubOpen} className="ml-auto h-4 w-4 text-muted" />
                </button>
                {isSubOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
                    {subKey === "state" && homeState && (
                      <>
                        <Link
                          href={regionUrl(homeState.countryId, homeState.id)}
                          onClick={onClose}
                          className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                        >
                          {t("state.overview")}
                        </Link>
                        {currentParty && (
                          <Link
                            href={regionPartyUrl(
                              homeState.countryId,
                              homeState.id,
                              currentParty.id
                            )}
                            onClick={onClose}
                            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                          >
                            {homeState.name} · {currentParty.name}
                          </Link>
                        )}
                        <Link
                          href={`${regionUrl(homeState.countryId, homeState.id)}?tab=economy`}
                          onClick={onClose}
                          className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                        >
                          {t("state.economy")}
                        </Link>
                        <Link
                          href={regionElectionsUrl(homeState.countryId, homeState.id)}
                          onClick={onClose}
                          className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                        >
                          {t("state.elections")}
                        </Link>
                        <Link
                          href={regionLegislatureUrl(homeState.countryId, homeState.id)}
                          onClick={onClose}
                          className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                        >
                          {stateLegislatureLabel}
                        </Link>
                        {governorOffice && governorOffice.stateId === homeState.id && (
                          <Link
                            href={`/country/${homeState.countryId.toLowerCase()}/region/${homeState.id.toLowerCase()}/office`}
                            onClick={onClose}
                            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                          >
                            {t("state.governorOffice")}
                          </Link>
                        )}
                        {cabinetOffice && (
                          <Link
                            href={`/country/${cabinetOffice.countryCode}/executive/cabinet/${cabinetOffice.positionId}/office`}
                            onClick={onClose}
                            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                          >
                            <span>{t("menus.nation.cabinetOffice")}</span>
                            <span className="ml-2 max-w-[120px] truncate text-xs text-muted">
                              {cabinetOffice.positionName}
                            </span>
                          </Link>
                        )}
                        {activeElection ? (
                          <Link
                            href={`/elections/${activeElection.seatId ?? activeElection.id}`}
                            onClick={onClose}
                            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                          >
                            <span>{t("state.myElection")}</span>
                            <span className="ml-2 max-w-[120px] truncate text-xs text-primary">
                              {activeElection.label}
                            </span>
                          </Link>
                        ) : (
                          <div className="flex items-center rounded-lg px-3 py-2 text-sm text-muted opacity-50">
                            {t("state.myElectionNone")}
                          </div>
                        )}
                      </>
                    )}
                    {subKey === "world" && (
                      <>
                        {/* Pinned/personal link, ungrouped — mirrors the loose
                            Home Nation / My Party links above the Nation
                            groups below. */}
                        {looseWorldNavItems(worldSubItems).map((sub) => (
                          <Link
                            key={sub.id}
                            href={sub.href}
                            onClick={onClose}
                            className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${
                              sub.primary ? "text-primary" : "text-muted"
                            }`}
                          >
                            {sub.labelKey ? t(sub.labelKey) : sub.label}
                          </Link>
                        ))}
                        {buildWorldNavSections(worldSubItems).map((group) => (
                          <CollapsibleNavSection
                            key={group.id}
                            title={t(group.titleKey)}
                            collapsible
                            defaultOpen={false}
                            className="mt-2"
                            labelClassName="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted/70"
                          >
                            {group.items.map((item) => (
                              <Link
                                key={item.id}
                                href={item.href}
                                onClick={onClose}
                                className={`flex items-center rounded-lg py-2 text-sm text-muted transition-colors hover:bg-white/5 ${
                                  item.parentId != null
                                    ? "ml-4 border-l border-card-border pl-3 pr-3"
                                    : "px-3"
                                }`}
                              >
                                {item.labelKey ? t(item.labelKey) : item.label}
                              </Link>
                            ))}
                          </CollapsibleNavSection>
                        ))}
                      </>
                    )}
                    {subKey === "nation" && (
                      <>
                        <Link
                          href={countryUrl(userCountry as CountryId)}
                          onClick={onClose}
                          className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                        >
                          {t("menus.nation.homeNation")}
                        </Link>
                        {cabinetOffice && (
                          <Link
                            href={cabinetOfficeUrl(
                              cabinetOffice.countryCode,
                              cabinetOffice.positionId
                            )}
                            onClick={onClose}
                            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                          >
                            {t("menus.nation.cabinetOffice")}
                          </Link>
                        )}
                        {currentParty && (
                          <Link
                            href={partyUrl(currentParty.countryId ?? pageCountry, currentParty.id)}
                            onClick={onClose}
                            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                          >
                            {t("menus.nation.myParty")} · {currentParty.name}
                          </Link>
                        )}
                        {userCountry === "US" && (
                          <Link
                            href="/political-operations"
                            onClick={onClose}
                            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                          >
                            {t("menus.nation.myPoliticalOperations")}
                          </Link>
                        )}
                        <MobileNationalDetails
                          countryId={pageCountry as CountryId}
                          charters={charterEntry}
                          hasActiveReferendumCampaign={hasActiveReferendumCampaign}
                          unionsEnabled={unionsEnabled}
                          onNavigate={onClose}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          }
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onClose}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-[10px] px-3.5 py-3 text-[15px] transition-colors hover:bg-white/5 ${
                active ? "bg-card font-semibold text-foreground" : "text-fg-2"
              }`}
            >
              <NavIcon name={item.icon} className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="my-3 h-px bg-card-border" />

      {/* Nation-view switcher — collapsible list of registered nations */}
      <button
        type="button"
        onClick={() => toggleMobileSub("country")}
        aria-expanded={!!mobileSubOpen.country}
        className="flex w-full items-center gap-3 rounded-[10px] px-3.5 py-3 text-[15px] font-medium text-fg-2 transition-colors hover:bg-white/5"
      >
        <CountryFlag country={pageCountry} size="md" />
        <span>{countryName(pageCountry as CountryId)}</span>
        <Chevron open={!!mobileSubOpen.country} className="ml-auto h-4 w-4 text-muted" />
      </button>
      {mobileSubOpen.country && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
          {switchableCountries.map((c) => {
            const isCurrent = c === pageCountry;
            const isHome = c === userCountry;
            return (
              <Link
                key={c}
                href={countryUrl(c)}
                onClick={onClose}
                aria-current={isCurrent ? "true" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 ${
                  isCurrent ? "font-medium text-foreground" : "text-muted"
                }`}
              >
                <CountryFlag country={c} size="sm" />
                <span>{countryName(c)}</span>
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
        </div>
      )}

      {/* Help section */}
      <button
        type="button"
        onClick={() => toggleMobileSub("help")}
        className="flex w-full items-center justify-between rounded-[10px] px-3.5 py-3 text-[15px] font-medium text-fg-2 transition-colors hover:bg-white/5"
        aria-expanded={!!mobileSubOpen.help}
      >
        <div className="flex items-center gap-3">
          <NavIcon name="Help" className="h-[18px] w-[18px]" />
          {t("help.helpResources")}
        </div>
        <Chevron open={!!mobileSubOpen.help} className="h-4 w-4 text-muted" />
      </button>
      {mobileSubOpen.help && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
          <Link
            href={showWiki ? "https://wiki.ahousedividedgame.com" : "/guides"}
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            {showWiki ? t("help.wikiGuides") : t("help.guides")}
          </Link>
          <Link
            href="/about"
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            {t("help.about")}
          </Link>
          <Link
            href="/feedback"
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            {t("help.suggestions")}
          </Link>
          {onOpenFeedback && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFeedback();
              }}
              disabled={feedbackCapturing}
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-white/5 disabled:cursor-wait disabled:opacity-70"
            >
              {feedbackCapturing ? t("common.capturingScreenshot") : t("common.quickSuggest")}
            </button>
          )}
          <a
            href={HELP_DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            Discord
          </a>
          <a
            href={HELP_PATREON_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            {t("help.patreon")}
          </a>
          <a
            href={HELP_SUPPORTER_WALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            {t("help.supporterWall")}
          </a>
          <a
            href={HELP_SUPPORT_EMAIL}
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            {t("help.emailSupport")}
          </a>
          <div className="my-1 border-t border-card-border/60" />
          <Link
            href="/privacy"
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            {t("help.privacy")}
          </Link>
          <Link
            href="/terms"
            onClick={onClose}
            className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
          >
            {t("help.terms")}
          </Link>
        </div>
      )}

      {/* Staff section — canonical staff tools for admin/mod */}
      {staffSubItems.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => toggleMobileSub("staff")}
            className="flex w-full items-center justify-between rounded-[10px] px-3.5 py-3 text-[15px] font-medium text-fg-2 transition-colors hover:bg-white/5"
            aria-expanded={!!mobileSubOpen.staff}
          >
            <span>{t("common.staff")}</span>
            <Chevron open={!!mobileSubOpen.staff} className="h-4 w-4 text-muted" />
          </button>
          {mobileSubOpen.staff && (
            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
              {staffSubItems.map((item) =>
                item.external ? (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onClose}
                    className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                  >
                    {t(item.labelKey)}
                  </a>
                ) : (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={onClose}
                    className="flex items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
                  >
                    {t(item.labelKey)}
                  </Link>
                )
              )}
            </div>
          )}
        </>
      )}

      {!user && (
        <div className="mt-3 flex flex-col gap-2">
          <Link
            href="/login"
            onClick={onClose}
            className="flex items-center justify-center rounded-lg border border-card-border bg-card py-2.5 text-sm font-medium text-foreground"
          >
            {t("common.signIn")}
          </Link>
          <Link
            href="/register"
            onClick={onClose}
            className="flex items-center justify-center rounded-lg bg-primary py-2.5 text-sm font-semibold text-white"
          >
            {t("common.register")}
          </Link>
        </div>
      )}
    </div>
  );
}
