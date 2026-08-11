import { OPS_DASHBOARD_URL } from "@/lib/urls";

export const DOCS_URL = "https://docs.ahousedividedgame.com";

export interface StaffNavItem {
  label: string;
  href: string;
  external?: boolean;
  show: boolean;
}

export interface StaffNavOpts {
  isAdmin?: boolean;
  isModerator?: boolean;
}

/**
 * Pure builder for staff-only navigation links. Consumed by StaffDropdown,
 * classic mobile Staff section, and ExperimentalNavbar.
 */
export function buildStaffNavItems({
  isAdmin = false,
  isModerator = false,
}: StaffNavOpts): StaffNavItem[] {
  return [
    { label: "Admin Panel", href: "/admin", show: isAdmin },
    { label: "Mod Panel", href: "/moderator", show: isAdmin || isModerator },
    { label: "Ops Dashboard", href: OPS_DASHBOARD_URL, external: true, show: isAdmin },
    { label: "Docs", href: DOCS_URL, external: true, show: isAdmin || isModerator },
    { label: "Tickets", href: `${OPS_DASHBOARD_URL}/tickets`, external: true, show: isAdmin },
    {
      label: "Suggestions",
      href: `${OPS_DASHBOARD_URL}/suggestions`,
      external: true,
      show: isAdmin,
    },
  ];
}

export function visibleStaffNavItems(opts: StaffNavOpts): StaffNavItem[] {
  return buildStaffNavItems(opts).filter((i) => i.show);
}

export function isStaffUser(opts: StaffNavOpts): boolean {
  return !!(opts.isAdmin || opts.isModerator);
}
