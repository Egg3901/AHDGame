"use client";

import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import {
  DROPDOWN_PANEL_CLASS,
  MENU_DIVIDER_CLASS,
  MENU_ROW_ACTIVE_CLASS,
  MENU_ROW_BASE_CLASS,
  MENU_ROW_IDLE_CLASS,
  MENU_SECTION_LABEL_CLASS,
} from "@/components/navbar/dropdownStyles";

export interface ProfileSwitcherCharacter {
  id: string;
  name: string;
  countryId: string;
  isActive: boolean;
}

export interface ProfileSwitcherImperialCharacter {
  id: string;
  name: string;
}

export type ProfileSwitcherVariant = "desktop" | "mobile";

interface ProfileSwitcherProps {
  variant: ProfileSwitcherVariant;
  characters: ProfileSwitcherCharacter[];
  imperialCharacter?: ProfileSwitcherImperialCharacter | null;
  isImperialMode: boolean;
  switchingCharacter?: boolean;
  switchingImperial?: boolean;
  charactersLabel: string;
  imperialLabel: string;
  activeLabel: string;
  /** Desktop only: GET switch URL for inactive characters. */
  characterSwitchHref?: (characterId: string) => string;
  imperialHref?: string;
  /** Mobile only: PATCH switch for inactive characters. */
  onSelectCharacter?: (characterId: string) => void;
  onSelectImperial?: (target: "character" | "imperial") => void;
  onNavigate?: () => void;
}

export function ImperialMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`${className} shrink-0 text-amber-400/80`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"
      />
    </svg>
  );
}

function ActivePill({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
      <svg
        className="h-3 w-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
      {label}
    </span>
  );
}

const ROW_BASE =
  "flex w-full items-center gap-2.5 rounded-lg text-sm transition-colors disabled:opacity-50";

const ROW_STYLE: Record<ProfileSwitcherVariant, { row: string; active: string; idle: string }> = {
  desktop: {
    row: MENU_ROW_BASE_CLASS,
    active: MENU_ROW_ACTIVE_CLASS,
    idle: MENU_ROW_IDLE_CLASS,
  },
  mobile: {
    row: `${ROW_BASE} px-3 py-2`,
    active: "bg-white/5 font-medium text-foreground",
    idle: "text-muted hover:bg-white/5 hover:text-foreground",
  },
};

export function ProfileSwitcher({
  variant,
  characters,
  imperialCharacter,
  isImperialMode,
  switchingCharacter = false,
  switchingImperial = false,
  charactersLabel,
  imperialLabel,
  activeLabel,
  characterSwitchHref,
  imperialHref,
  onSelectCharacter,
  onSelectImperial,
  onNavigate,
}: ProfileSwitcherProps) {
  const style = ROW_STYLE[variant];

  const renderCharacterRow = (char: ProfileSwitcherCharacter) => {
    const isActiveChar = char.isActive && !isImperialMode;
    const inner = (
      <>
        <CountryFlag country={char.countryId} size="sm" />
        <span className="min-w-0 flex-1 truncate">{char.name}</span>
        {isActiveChar ? (
          <ActivePill label={activeLabel} />
        ) : (
          <span className="shrink-0 text-xs text-muted/60">{char.countryId}</span>
        )}
      </>
    );

    if (isActiveChar) {
      return (
        <Link
          key={char.id}
          href="/profile"
          onClick={onNavigate}
          className={`${style.row} ${style.active}`}
        >
          {inner}
        </Link>
      );
    }
    if (isImperialMode) {
      return (
        <button
          key={char.id}
          type="button"
          onClick={() => {
            onNavigate?.();
            onSelectImperial?.("character");
          }}
          disabled={switchingImperial}
          className={`${style.row} ${style.idle} cursor-pointer`}
        >
          {inner}
        </button>
      );
    }
    if (variant === "desktop" && characterSwitchHref) {
      return (
        <a
          key={char.id}
          href={characterSwitchHref(char.id)}
          className={`${style.row} ${style.idle}`}
        >
          {inner}
        </a>
      );
    }
    return (
      <button
        key={char.id}
        type="button"
        onClick={() => {
          onNavigate?.();
          onSelectCharacter?.(char.id);
        }}
        disabled={switchingCharacter}
        className={`${style.row} ${style.idle} cursor-pointer`}
      >
        {inner}
      </button>
    );
  };

  const renderImperialRow = () => {
    if (!imperialCharacter) return null;
    const inner = (
      <>
        <ImperialMark />
        <span className="min-w-0 flex-1 truncate">{imperialCharacter.name}</span>
        {isImperialMode ? (
          <ActivePill label={activeLabel} />
        ) : (
          <span className="shrink-0 rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] font-medium text-amber-400/80">
            {imperialLabel}
          </span>
        )}
      </>
    );
    if (isImperialMode) {
      return (
        <Link
          href={imperialHref ?? `/imperial/${imperialCharacter.id}`}
          onClick={onNavigate}
          className={`${style.row} ${style.active}`}
        >
          {inner}
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          onSelectImperial?.("imperial");
        }}
        disabled={switchingImperial}
        className={`${style.row} ${style.idle} cursor-pointer`}
      >
        {inner}
      </button>
    );
  };

  if (variant === "mobile") {
    return (
      <div className="mt-0.5 space-y-0.5 border-l border-card-border/60 pl-3">
        <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted/60">
          {charactersLabel}
        </p>
        {characters.map(renderCharacterRow)}
        {imperialCharacter && (
          <>
            <div className="mx-3 border-t border-card-border/40 py-1">
              <p className="py-1 text-xs font-medium uppercase tracking-wider text-amber-400/60">
                {imperialLabel}
              </p>
            </div>
            {renderImperialRow()}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      role="menu"
      className={`absolute left-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-card-border bg-card shadow-modal ${DROPDOWN_PANEL_CLASS}`}
    >
      <div className="px-1.5 pb-1.5">
        <p className={MENU_SECTION_LABEL_CLASS}>{charactersLabel}</p>
        {characters.map(renderCharacterRow)}
        {imperialCharacter && (
          <>
            <div className={MENU_DIVIDER_CLASS} />
            <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400/60">
              {imperialLabel}
            </p>
            {renderImperialRow()}
          </>
        )}
      </div>
    </div>
  );
}
