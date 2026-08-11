import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { countryElectionsUrl } from "@/lib/urls";

export interface ExperimentalSubNavItem {
  label: string;
  href: string;
  strong?: boolean;
  meta?: string;
  metaClass?: string;
}

/**
 * Legislature submenu items for the experimental navbar's primary tab dropdown.
 * US keeps legacy /congress routes; other countries use country-config paths.
 */
export function buildLegislatureSubNavItems(countryId: CountryId): ExperimentalSubNavItem[] {
  const config = getCountryConfig(countryId);
  const leg = config.legislature;
  const usesLegacyCongressRoutes = leg.path === "/country/us/legislature";

  if (usesLegacyCongressRoutes) {
    return [
      { label: "House of Representatives", href: "/congress", strong: true, meta: "435" },
      { label: "Senate", href: "/congress?chamber=senate", meta: "100" },
      { label: "Committees", href: "/congress?tab=committees" },
      { label: "Active legislation", href: "/congress?tab=legislation", metaClass: "text-primary" },
      { label: "Floor schedule", href: "/congress?tab=schedule" },
    ];
  }

  const items: ExperimentalSubNavItem[] = [{ label: leg.name, href: leg.path, strong: true }];

  if (leg.bicameral && leg.lowerChamber) {
    items.push({
      label: leg.lowerChamber.name,
      href: `${leg.path}?chamber=${leg.lowerChamber.key}`,
      meta: leg.lowerChamber.seats != null ? String(leg.lowerChamber.seats) : undefined,
    });
  }
  if (leg.bicameral && leg.upperChamber?.elected) {
    items.push({
      label: leg.upperChamber.name,
      href: `${leg.path}?chamber=${leg.upperChamber.key}`,
      meta: leg.upperChamber.seats != null ? String(leg.upperChamber.seats) : undefined,
    });
  }

  return items;
}

/** Elections submenu items for the experimental navbar. */
export function buildElectionsSubNavItems(countryId: CountryId): ExperimentalSubNavItem[] {
  const electionsBase = countryElectionsUrl(countryId);
  const config = getCountryConfig(countryId);
  const usesLegacyCongressRoutes = config.legislature.path === "/country/us/legislature";
  const items: ExperimentalSubNavItem[] = [
    { label: "Upcoming races", href: electionsBase, strong: true },
  ];

  if (usesLegacyCongressRoutes) {
    items.push(
      { label: "Primaries", href: "/elections?tab=primaries" },
      { label: "Results", href: "/elections?tab=results" },
      { label: "Candidate directory", href: "/politicians" }
    );
  } else {
    items.push({
      label: "Candidate directory",
      href: `/country/${countryId.toLowerCase()}/politicians`,
    });
  }

  return items;
}

/** Primary nav tab label/href for the legislature section. */
export function getLegislatureNavTab(countryId: CountryId): { label: string; href: string } {
  const config = getCountryConfig(countryId);
  const usesLegacyCongressRoutes = config.legislature.path === "/country/us/legislature";
  if (usesLegacyCongressRoutes) {
    return { label: "Congress", href: "/congress" };
  }
  return { label: config.legislature.name, href: config.legislature.path };
}

/** Map path from country config (nation details "map" item uses the same path). */
export function getMapNavHref(countryId: CountryId): string {
  return getCountryConfig(countryId).mapPath;
}
