import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isSupportedLocale } from "./locales";

type Messages = Record<string, unknown>;

// A key missing from a translated catalog falls back to the English string,
// never to a raw message id on screen.
function mergeWithFallback(base: Messages, overlay: Messages): Messages {
  const merged: Messages = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const baseValue = merged[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue)
    ) {
      merged[key] = mergeWithFallback(baseValue as Messages, value as Messages);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

// One catalog file per top-level namespace, under messages/<locale>/. Keeping
// namespaces in separate files keeps catalog diffs reviewable as they grow.
const NAMESPACES = ["layout", "nav", "settings", "tutorial"] as const;

async function loadCatalog(locale: string): Promise<Messages> {
  const parts = await Promise.all(
    NAMESPACES.map(
      async (ns) => (await import(`../../messages/${locale}/${ns}.json`)).default as Messages
    )
  );
  return parts.reduce((acc, part) => ({ ...acc, ...part }), {});
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isSupportedLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;

  const english = await loadCatalog(DEFAULT_LOCALE);
  const messages =
    locale === DEFAULT_LOCALE
      ? english
      : mergeWithFallback(english, await loadCatalog(locale));

  return { locale, messages };
});
