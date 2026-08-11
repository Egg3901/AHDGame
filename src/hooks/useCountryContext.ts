import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { CountryId } from "@/lib/constants/countries";
import {
  resolveCountryContext,
  toCountryId,
  type CountryContext,
} from "@/lib/navigation/countryContext";

export const PAGE_COUNTRY_OVERRIDE_EVENT = "ahd:page-country-override";
const PAGE_COUNTRY_OVERRIDE_DATASET_KEY = "ahdPageCountry";
let nextPageCountryOverrideOwnerId = 1;

type PageCountryOverrideRegistry = Map<string, CountryId>;

export { resolveCountryContext, toCountryId } from "@/lib/navigation/countryContext";
export type { CountryContext } from "@/lib/navigation/countryContext";

export function getCurrentPageCountryOverride(
  registry: ReadonlyMap<string, CountryId>
): CountryId | null {
  let current: CountryId | null = null;
  for (const countryId of registry.values()) {
    current = countryId;
  }
  return current;
}

export function setPageCountryOverrideForOwner(
  registry: PageCountryOverrideRegistry,
  ownerId: string,
  countryId: CountryId | null
): CountryId | null {
  if (countryId) {
    registry.set(ownerId, countryId);
  } else {
    registry.delete(ownerId);
  }
  return getCurrentPageCountryOverride(registry);
}

export function clearPageCountryOverrideForOwner(
  registry: PageCountryOverrideRegistry,
  ownerId: string
): CountryId | null {
  registry.delete(ownerId);
  return getCurrentPageCountryOverride(registry);
}

function getPageCountryOverrideRegistry(): PageCountryOverrideRegistry {
  if (typeof window === "undefined") {
    return new Map<string, CountryId>();
  }

  const windowWithRegistry = window as typeof window & {
    __ahdPageCountryOverrides?: PageCountryOverrideRegistry;
  };
  if (!windowWithRegistry.__ahdPageCountryOverrides) {
    windowWithRegistry.__ahdPageCountryOverrides = new Map<string, CountryId>();
  }
  return windowWithRegistry.__ahdPageCountryOverrides;
}

function syncPageCountryOverride(currentCountryId: CountryId | null) {
  if (typeof document === "undefined") return;

  if (currentCountryId) {
    document.documentElement.dataset[PAGE_COUNTRY_OVERRIDE_DATASET_KEY] = currentCountryId;
  } else {
    delete document.documentElement.dataset[PAGE_COUNTRY_OVERRIDE_DATASET_KEY];
  }

  window.dispatchEvent(
    new CustomEvent(PAGE_COUNTRY_OVERRIDE_EVENT, {
      detail: { countryId: currentCountryId },
    })
  );
}

function readPageCountryOverride(): CountryId | null {
  if (typeof window === "undefined") return null;
  const registryOverride = getCurrentPageCountryOverride(getPageCountryOverrideRegistry());
  if (registryOverride) return registryOverride;
  if (typeof document === "undefined") return null;
  return toCountryId(document.documentElement.dataset[PAGE_COUNTRY_OVERRIDE_DATASET_KEY]);
}

export function useCountryContext(
  _homeStateId?: string,
  homeCountryId?: string,
  initialPageCountry?: CountryId | null
): CountryContext {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [initialPathname] = useState(pathname);
  const [pageCountryOverride, setPageCountryOverride] = useState<CountryId | null>(() =>
    readPageCountryOverride()
  );

  useEffect(() => {
    const handleOverride = (event: Event) => {
      const detail = (event as CustomEvent<{ countryId?: string | null }>).detail;
      setPageCountryOverride(toCountryId(detail?.countryId));
    };

    window.addEventListener(PAGE_COUNTRY_OVERRIDE_EVENT, handleOverride as EventListener);
    return () => {
      window.removeEventListener(PAGE_COUNTRY_OVERRIDE_EVENT, handleOverride as EventListener);
    };
  }, []);

  const bootstrappedInitialPageCountry = pathname === initialPathname ? initialPageCountry : null;

  return resolveCountryContext({
    pathname,
    queryCountryId: searchParams.get("country"),
    homeCountryId,
    initialPageCountry: pageCountryOverride ?? bootstrappedInitialPageCountry,
  });
}

export function usePageCountryOverride(countryId?: string | null): void {
  const normalizedCountryId = toCountryId(countryId);
  const ownerIdRef = useRef<string | null>(null);

  if (!ownerIdRef.current) {
    ownerIdRef.current = `page-country-override-${nextPageCountryOverrideOwnerId++}`;
  }

  useEffect(() => {
    if (typeof document === "undefined") return;

    const ownerId = ownerIdRef.current;
    if (!ownerId) return;

    syncPageCountryOverride(
      setPageCountryOverrideForOwner(getPageCountryOverrideRegistry(), ownerId, normalizedCountryId)
    );

    return () => {
      syncPageCountryOverride(
        clearPageCountryOverrideForOwner(getPageCountryOverrideRegistry(), ownerId)
      );
    };
  }, [normalizedCountryId]);
}
