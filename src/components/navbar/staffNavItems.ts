import { OPS_DASHBOARD_URL } from "@/lib/urls";

export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.lakesidegames.net";

export interface StaffNavItem {
  label: string;
  /** Message id under the "nav" namespace; renderers resolve via t(labelKey). */
  labelKey: string;
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
    { label: "Admin Panel", labelKey: "menus.staff.adminPanel", href: "/admin", show: isAdmin },
    {
      label: "Mod Panel",
      labelKey: "menus.staff.modPanel",
      href: "/moderator",
      show: isAdmin || isModerator,
    },
    {
      label: "Ops Dashboard",
      labelKey: "menus.staff.opsDashboard",
      href: OPS_DASHBOARD_URL,
      external: true,
      show: isAdmin && OPS_DASHBOARD_URL !== "",
    },
    {
      label: "Docs",
      labelKey: "menus.staff.docs",
      href: DOCS_URL,
      external: true,
      show: isAdmin || isModerator,
    },
    {
      label: "Tickets",
      labelKey: "menus.staff.tickets",
      href: `${OPS_DASHBOARD_URL}/tickets`,
      external: true,
      show: isAdmin && OPS_DASHBOARD_URL !== "",
    },
    {
      label: "Suggestions",
      labelKey: "menus.staff.suggestions",
      href: `${OPS_DASHBOARD_URL}/suggestions`,
      external: true,
      show: isAdmin && OPS_DASHBOARD_URL !== "",
    },
  ];
}

export function visibleStaffNavItems(opts: StaffNavOpts): StaffNavItem[] {
  return buildStaffNavItems(opts).filter((i) => i.show);
}

export function isStaffUser(opts: StaffNavOpts): boolean {
  return !!(opts.isAdmin || opts.isModerator);
}
