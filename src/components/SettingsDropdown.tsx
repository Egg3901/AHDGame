"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useEnabledCountries } from "@/contexts/RegisteredCountriesContext";
import { CountryFlag } from "@/components/CountryFlag";
import { countryUrl } from "@/lib/urls";
import { DROPDOWN_PANEL_CLASS } from "@/components/navbar/dropdownStyles";

interface SettingsDropdownProps {
  user: {
    username: string;
    isAdmin?: boolean;
    isModerator?: boolean;
    patreonTier?: string | null;
    isPatronActive?: boolean;
  };
  onSignOut: () => void;
  pageCountry: CountryId;
  userCountry: CountryId;
}

function getSandboxToggleInfo() {
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

export function SettingsDropdown({
  user,
  onSignOut,
  pageCountry,
  userCountry,
}: SettingsDropdownProps) {
  const t = useTranslations("nav");
  const [isOpen, setIsOpen] = useState(false);
  const [showNationPicker, setShowNationPicker] = useState(false);
  const enabledCountries = useEnabledCountries();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowNationPicker(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showNationPicker) {
          setShowNationPicker(false);
        } else {
          setIsOpen(false);
        }
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, showNationPicker]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-card hover:text-foreground ${isOpen ? "text-foreground bg-card" : "text-muted"}`}
        aria-label={t("common.settings")}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <svg
          className={`h-5 w-5 transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
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
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`absolute right-0 z-50 mt-2 w-56 rounded-xl border border-card-border bg-card shadow-modal ${DROPDOWN_PANEL_CLASS}`}
        >
          {showNationPicker ? (
            <>
              <div className="flex items-center gap-2 border-b border-card-border/60 px-3 py-2.5">
                <button
                  onClick={() => setShowNationPicker(false)}
                  className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors"
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
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  {t("common.back")}
                </button>
                <p className="text-xs font-medium uppercase tracking-wider text-muted">
                  {t("countrySwitcher.selectNation")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-2">
                {enabledCountries.map((id) => {
                  const cfg = COUNTRY_CONFIGS[id];
                  const isHome = id === userCountry;
                  const isCurrent = id === pageCountry;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setIsOpen(false);
                        setShowNationPicker(false);
                        router.push(countryUrl(id));
                      }}
                      className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-center transition-colors hover:bg-background/60 ${
                        isCurrent ? "ring-1 ring-primary/60 bg-primary/10" : ""
                      }`}
                    >
                      <CountryFlag country={id} size="lg" />
                      <span className="text-xs leading-tight text-foreground truncate w-full">
                        {cfg.name}
                      </span>
                      {isHome && (
                        <span className="text-[10px] text-muted leading-none">
                          {t("countrySwitcher.homeBadge")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="border-b border-card-border/60 px-4 py-2.5">
                <p className="text-xs uppercase tracking-widest text-muted font-medium">
                  {t("userMenu.signedInAs")}
                </p>
                <p className="truncate text-sm font-semibold text-foreground">{user.username}</p>
              </div>
              <div className="py-1">
                <Link
                  href="/settings"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background/60"
                >
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
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  {t("userMenu.profileSettings")}
                </Link>

                <button
                  onClick={() => setShowNationPicker(true)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background/60"
                >
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
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {t("countrySwitcher.switchNationView")}
                </button>

                {(() => {
                  const canAccessSandbox =
                    user.isAdmin ||
                    user.isModerator ||
                    ((user.patreonTier === "supporter-plus" ||
                      user.patreonTier === "supporter-plus-plus") &&
                      user.isPatronActive);
                  if (!canAccessSandbox) return null;
                  const { url, isSandbox } = getSandboxToggleInfo();
                  return (
                    <a
                      href={url}
                      target="_self"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background/60"
                    >
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
                          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                        />
                      </svg>
                      {isSandbox ? t("userMenu.switchToMainSite") : t("userMenu.switchToSandbox")}
                    </a>
                  );
                })()}

                <button
                  onClick={() => {
                    setIsOpen(false);
                    onSignOut();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-error transition-colors hover:bg-background/60"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  {t("common.signOut")}
                </button>
              </div>

              <Link
                href="/changelog"
                onClick={() => setIsOpen(false)}
                className="block border-t border-card-border px-4 py-2 text-center text-xs text-muted hover:text-foreground transition-colors"
              >
                v{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"} ·{" "}
                {process.env.NEXT_PUBLIC_GIT_COMMIT ?? "dev"}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
