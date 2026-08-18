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

/**
 * Corp and union rows for the avatar profile card. Profile / Actions / wallet
 * already live on that card; these are the extras when the viewer has them.
 */
export function visibleProfileOrgItems(opts: ProfileNavOpts = {}): ProfileNavItem[] {
  return visibleProfileNavItems(opts).filter(
    (item) => item.id === "corporation" || item.id === "union"
  );
}
