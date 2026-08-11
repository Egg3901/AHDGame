"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { DROPDOWN_PANEL_CLASS } from "@/components/navbar/dropdownStyles";
import {
  isStaffUser,
  visibleStaffNavItems,
  type StaffNavOpts,
} from "@/components/navbar/staffNavItems";

export { DOCS_URL } from "@/components/navbar/staffNavItems";

type StaffDropdownProps = StaffNavOpts;

/**
 * Staff-only navigation menu. Replaces the old single admin "Ops" link with a
 * dropdown of staff tools. Each item is gated by role: admins see everything,
 * moderators see only what they can use (Mod Panel + Docs). The trigger is
 * hidden entirely for non-staff.
 */
export function StaffDropdown({ isAdmin = false, isModerator = false }: StaffDropdownProps) {
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

  if (!isStaffUser({ isAdmin, isModerator })) return null;

  const visible = visibleStaffNavItems({ isAdmin, isModerator });
  if (visible.length === 0) return null;

  const itemClass =
    "flex items-center gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background/60";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-card hover:text-foreground"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        Staff
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
          className={`absolute right-0 z-50 mt-2 w-52 rounded-xl border border-card-border bg-card shadow-modal ${DROPDOWN_PANEL_CLASS}`}
        >
          <div className="py-1">
            {visible.map((item) =>
              item.external ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsOpen(false)}
                  className={itemClass}
                  role="menuitem"
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={itemClass}
                  role="menuitem"
                >
                  {item.label}
                </Link>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
