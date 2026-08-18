"use client";

/**
 * User / profile dropdown for {@link ExperimentalNavbar} — avatar header card,
 * profile/notifications/wallet rows, admin character switching (incl. imperial
 * mode), sandbox toggle, and sign out. Presentation only: all state and the
 * switch/sign-out handlers live in the navbar and are passed down.
 */

import React, { type RefObject } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { Avatar } from "@/components/Avatar";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { DropdownPanel, MenuRow } from "./experimentalNavPrimitives";
import type { ProfileNavItem } from "./profileNavItems";
import type {
  AdminCharacter,
  CharacterProfile,
  ImperialCharacterNav,
  NavLinkRef,
} from "./experimentalNavTypes";

export function getSandboxToggleInfo() {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  const isSandbox =
    hostname.includes("sandbox") ||
    baseUrl.includes("sandbox") ||
    hostname.includes("staging") ||
    baseUrl.includes("staging");
  const mainSiteUrl = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "https://ahousedividedgame.com";
  const sandboxUrl = process.env.NEXT_PUBLIC_SANDBOX_URL || "https://sandbox.ahousedividedgame.com";
  return {
    isSandbox,
    url: isSandbox ? mainSiteUrl : sandboxUrl,
  };
}

export interface ExperimentalUserMenuProps {
  user: NavLinkRef;
  characterProfile?: CharacterProfile;
  profileDisplayName: string;
  showProfile: boolean;
  isImperialMode: boolean;
  unreadCount: number;
  adminCharacters?: AdminCharacter[];
  imperialCharacter?: ImperialCharacterNav;
  switchingCharacter: boolean;
  switchingImperial: boolean;
  canAccessSandbox?: boolean;
  profileOrgItems?: ProfileNavItem[];
  closeAll: () => void;
  handleSwitchCharacter: (characterId: string) => Promise<void>;
  handleSwitchImperial: (type: "character" | "imperial") => Promise<void>;
  handleSignOut: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
}

export function ExperimentalUserMenu({
  user,
  characterProfile,
  profileDisplayName,
  showProfile,
  isImperialMode,
  unreadCount,
  adminCharacters,
  imperialCharacter,
  switchingCharacter,
  switchingImperial,
  canAccessSandbox,
  profileOrgItems = [],
  closeAll,
  handleSwitchCharacter,
  handleSwitchImperial,
  handleSignOut,
  anchorRef,
  panelRef,
}: ExperimentalUserMenuProps) {
  const t = useTranslations("nav");
  return (
    <DropdownPanel
      anchorRef={anchorRef}
      panelRef={panelRef}
      align="right"
      width="w-[300px]"
      padded={false}
    >
      <div className="relative">
        <div className="relative h-24 overflow-hidden">
          {characterProfile?.profileHeaderImageUrl ? (
            <Image
              src={characterProfile.profileHeaderImageUrl}
              alt=""
              fill
              className="object-cover object-center"
              sizes="300px"
              unoptimized={bypassNextImageOptimization(characterProfile.profileHeaderImageUrl)}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-card-elevated to-secondary/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/55 to-transparent" />
        </div>
        <div className="absolute left-4 top-24 z-10 -translate-y-1/2">
          <div className="rounded-lg border-[3px] border-card bg-card shadow-panel">
            <Avatar
              url={characterProfile?.avatarUrl}
              name={profileDisplayName}
              size="h-14 w-14"
              borderKey={characterProfile?.borderKey}
              tintColor={characterProfile?.tintColor}
              className="rounded-md"
            />
          </div>
        </div>
        <div className="px-4 pb-3 pt-10">
          <p className="truncate text-sm font-semibold text-foreground">{profileDisplayName}</p>
          <p className="truncate text-xs text-muted">@{user.username}</p>
        </div>
      </div>

      <div className="border-t border-card-border p-1.5">
        <MenuRow href="/profile" onNavigate={closeAll} strong>
          {t("common.profile")}
        </MenuRow>
        {showProfile && (
          <MenuRow href="/notifications" onNavigate={closeAll}>
            {t("common.notifications")}
            {unreadCount > 0 ? ` (${unreadCount > 9 ? "9+" : unreadCount})` : ""}
          </MenuRow>
        )}
        {showProfile && !isImperialMode && (
          <MenuRow href="/actions" onNavigate={closeAll}>
            {t("common.actions")}
          </MenuRow>
        )}
        {profileOrgItems.map((item) => (
          <MenuRow key={item.id} href={item.href} onNavigate={closeAll} dot="bg-primary">
            {t(item.labelKey)}
          </MenuRow>
        ))}
        {showProfile && (
          <MenuRow href="/portfolio?tab=currency" onNavigate={closeAll}>
            {t("common.wallet")}
          </MenuRow>
        )}
        {showProfile && ((adminCharacters && adminCharacters.length > 1) || imperialCharacter) && (
          <>
            <div className="my-1 h-px bg-card-border" />
            <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              {t("userMenu.characters")}
            </div>
            {adminCharacters?.map((char) =>
              char.isActive && !isImperialMode ? (
                <div
                  key={char.id}
                  className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] text-foreground"
                >
                  <span>{char.name}</span>
                  <span className="text-[10px] text-primary font-medium">{t("common.active")}</span>
                </div>
              ) : isImperialMode ? (
                <button
                  key={char.id}
                  type="button"
                  onClick={() => {
                    closeAll();
                    void handleSwitchImperial("character");
                  }}
                  disabled={switchingImperial}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-white/5 disabled:opacity-50"
                >
                  <span>{char.name}</span>
                  <span className="text-[10px] text-muted/60">{char.countryId}</span>
                </button>
              ) : (
                <button
                  key={char.id}
                  type="button"
                  onClick={() => {
                    closeAll();
                    void handleSwitchCharacter(char.id);
                  }}
                  disabled={switchingCharacter}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-white/5 disabled:opacity-50"
                >
                  <span>{char.name}</span>
                  <span className="text-[10px] text-muted/60">{char.countryId}</span>
                </button>
              )
            )}
            {imperialCharacter && (
              <>
                <div className="my-1 h-px bg-card-border" />
                {isImperialMode ? (
                  <Link
                    href={`/imperial/${imperialCharacter.id}`}
                    onClick={closeAll}
                    className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] text-foreground transition-colors hover:bg-white/5"
                  >
                    <span>{imperialCharacter.name}</span>
                    <span className="text-[10px] text-primary font-medium">
                      {t("common.active")}
                    </span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      closeAll();
                      void handleSwitchImperial("imperial");
                    }}
                    disabled={switchingImperial}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-white/5 disabled:opacity-50"
                  >
                    <span>{imperialCharacter.name}</span>
                    <span className="text-[10px] text-amber-400/70">{t("common.imperial")}</span>
                  </button>
                )}
              </>
            )}
          </>
        )}
        <div className="my-1 h-px bg-card-border" />
        <MenuRow href="/settings" onNavigate={closeAll}>
          {t("common.settings")}
        </MenuRow>
        {canAccessSandbox &&
          (() => {
            const { url, isSandbox } = getSandboxToggleInfo();
            return (
              <a
                href={url}
                target="_self"
                onClick={closeAll}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 transition-colors hover:bg-white/5"
              >
                {isSandbox ? t("userMenu.switchToMainSite") : t("userMenu.switchToSandbox")}
              </a>
            );
          })()}
        <div className="my-1 h-px bg-card-border" />
        <button
          type="button"
          onClick={() => {
            closeAll();
            handleSignOut();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-error transition-colors hover:bg-white/5"
        >
          {t("common.signOut")}
        </button>
      </div>
      <Link
        href="/changelog"
        onClick={closeAll}
        className="block border-t border-card-border px-4 py-2 text-center text-[11px] text-muted transition-colors hover:text-foreground"
      >
        v{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"} ·{" "}
        {process.env.NEXT_PUBLIC_GIT_COMMIT ?? "dev"}
      </Link>
    </DropdownPanel>
  );
}
