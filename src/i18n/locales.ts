// Locales the UI chrome ships in. Game-generated text (news, mail,
// notifications, world events) and catalog content remain English for now;
// this list only gates the chrome message catalogs under /messages.
export const SUPPORTED_LOCALES = ["en", "de"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// Cookie-based locale selection, no URL prefix: every existing path, redirect
// and deep link keeps working, and crawlers keep seeing the English site.
export const LOCALE_COOKIE = "ahd-locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

export function isSupportedLocale(value: string | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
