export type ProfileNavItemId = "profile" | "actions" | "corporation" | "union";

export interface ProfileNavItem {
  id: ProfileNavItemId;
  label: string;
  /** Message id under the "nav" namespace; renderers resolve via t(labelKey). */
  labelKey: string;
  href: string;
  show: boolean;
}

export interface ProfileNavOpts {
  myCorporationId?: number | null;
  myUnionId?: string | null;
  unionsEnabled?: boolean;
}

/**
 * Pure builder for the Profile dropdown (desktop tab + mobile collapsible).
 * Order is the contract: Profile, then Actions, then corp if the viewer is
 * CEO, then union if they lead or organize one.
 */
export function buildProfileNavItems({
  myCorporationId = null,
  myUnionId = null,
  unionsEnabled = false,
}: ProfileNavOpts = {}): ProfileNavItem[] {
  return [
    {
      id: "profile",
      label: "Profile",
      labelKey: "common.profile",
      href: "/profile",
      show: true,
    },
    {
      id: "actions",
      label: "Actions",
      labelKey: "common.actions",
      href: "/actions",
      show: true,
    },
    {
      id: "corporation",
      label: "My Corporation",
      labelKey: "menus.world.myCorporation",
      href: `/corporation/${myCorporationId}`,
      show: myCorporationId != null,
    },
    {
      id: "union",
      label: "My Union",
      labelKey: "menus.profile.myUnion",
      href: `/unions/${myUnionId}`,
      show: unionsEnabled && myUnionId != null,
    },
  ];
}

export function visibleProfileNavItems(opts: ProfileNavOpts = {}): ProfileNavItem[] {
  return buildProfileNavItems(opts).filter((i) => i.show);
}
