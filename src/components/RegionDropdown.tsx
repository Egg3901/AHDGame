"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { UK_NATIONS } from "@/lib/constants/uk";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  regionUrl,
  regionPartyUrl,
  regionLegislatureUrl,
  legislatureUrl,
  countryUrl,
} from "@/lib/urls";

interface RegionDropdownProps {
  regionId: string;
  regionName: string;
  /** Country of the region being displayed (URL routing). */
  regionCountryId: CountryId;
  /** UK only — the devolved-nation grouping (ENG/SCO/WAL/NI). Ignored for other countries. */
  nationId?: string;
  currentParty?: {
    id: string;
    name: string;
    countryId: string;
  } | null;
}

export function RegionDropdown({
  regionId,
  regionName,
  regionCountryId,
  nationId,
  currentParty,
}: RegionDropdownProps) {
  // UK devolved-body section only renders when both nationId and the region
  // belong to the UK. JP/DE Länder/prefectures don't share this concept.
  const devolvedBody =
    regionCountryId === "UK" && nationId
      ? UK_NATIONS.find((n) => n.id === nationId)?.devolvedBody
      : undefined;
  // Show the "My Party" regional-branch link when the viewer's party is in
  // the same country as the region being viewed. Per-region party branch
  // pages exist at /country/<code>/region/<regionId>/party/<partyId>.
  const regionPartyLinkVisible = currentParty?.countryId === regionCountryId;
  const countryCfg = getCountryConfig(regionCountryId);
  const legislatureLabel = countryCfg?.legislature?.name ?? "Legislature";
  const countryDisplayName = countryCfg?.name ?? regionCountryId;
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-white/90 hover:text-white transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${regionName} menu`}
      >
        {regionName}
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
        <div className="absolute right-0 z-50 mt-2 w-56 max-w-[calc(100vw-1rem)] rounded-xl border border-card-border bg-card shadow-modal max-h-[calc(100vh-5rem)] overflow-y-auto overflow-x-hidden">
          <div className="py-1">
            {regionPartyLinkVisible && currentParty && (
              <Link
                href={regionPartyUrl(regionCountryId, regionId, currentParty.id)}
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
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
                <span className="truncate">My Party - {currentParty.name}</span>
              </Link>
            )}

            <Link
              href={regionUrl(regionCountryId, regionId)}
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
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
              Region Overview
            </Link>

            {devolvedBody && nationId && (
              <Link
                href={regionLegislatureUrl(regionCountryId, nationId)}
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
                    d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"
                  />
                </svg>
                {devolvedBody}
              </Link>
            )}
            <Link
              href={legislatureUrl(regionCountryId)}
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
                  d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"
                />
              </svg>
              {legislatureLabel}
            </Link>

            <Link
              href={countryUrl(regionCountryId)}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background/60 border-t border-card-border"
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
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              ← {countryDisplayName}
            </Link>
            <Link
              href="/world"
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
                  d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              ← World
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
