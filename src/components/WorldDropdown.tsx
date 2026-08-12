"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DROPDOWN_PANEL_CLASS } from "@/components/navbar/dropdownStyles";
import { visibleWorldNavItems, type WorldNavOpts } from "@/components/navbar/worldNavItems";

interface WorldDropdownProps extends WorldNavOpts {
  isUKContext?: boolean;
}

export function WorldDropdown({
  isUKContext: _isUKContext = false,
  countryId = "US",
  myCorporationId = null,
  conflictsEnabled = false,
}: WorldDropdownProps) {
  const t = useTranslations("nav");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const items = visibleWorldNavItems({
    countryId,
    myCorporationId,
    conflictsEnabled,
  });
  const corporate = items.filter((i) => i.section === "corporate");
  const leaderboard = items.filter((i) => i.section === "leaderboard");
  const main = items.filter((i) => i.section === "main");

  const linkClass =
    "flex items-center gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background/60";
  const primaryLinkClass =
    "flex items-center gap-2 px-4 py-2.5 text-sm text-primary transition-colors hover:bg-background/60";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-card hover:text-foreground"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {t("common.world")}
        <svg
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`absolute right-0 z-50 mt-2 w-56 rounded-xl border border-card-border bg-card shadow-modal ${DROPDOWN_PANEL_CLASS}`}
        >
          <div className="py-1">
            {corporate.length > 0 && (
              <div className="mb-1 border-b border-card-border pb-1">
                <p className="px-4 pt-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted">
                  {t("menus.world.headers.corporate")}
                </p>
                {corporate.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={primaryLinkClass}
                    role="menuitem"
                  >
                    {t(item.labelKey)}
                  </Link>
                ))}
              </div>
            )}

            {leaderboard.length > 0 && (
              <div className="mb-1 border-b border-card-border pb-1">
                <div className="flex items-center gap-2 px-4 pt-2 pb-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted">
                    {t("menus.world.headers.leaderboard")}
                  </p>
                  <span className="rounded-full bg-warning/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-warning">
                    Beta
                  </span>
                </div>
                {leaderboard.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={linkClass}
                    role="menuitem"
                  >
                    {t(item.labelKey)}
                  </Link>
                ))}
              </div>
            )}

            {main.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={linkClass}
                role="menuitem"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
