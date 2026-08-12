"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/i18n/setLocaleAction";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "@/i18n/locales";

export function LanguageSection() {
  const t = useTranslations("settings.language");
  const activeLocale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSelect = (locale: Locale) => {
    if (locale === activeLocale) return;
    startTransition(async () => {
      await setLocale(locale);
      router.refresh();
    });
  };

  return (
    <div className="border-t border-card-border pt-6">
      <h3 className="text-sm font-medium mb-1">{t("title")}</h3>
      <p className="text-xs text-muted mb-4">{t("description")}</p>
      <div className="flex gap-3 flex-wrap" role="radiogroup" aria-label={t("label")}>
        {SUPPORTED_LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={activeLocale === locale}
            disabled={isPending}
            onClick={() => handleSelect(locale)}
            className={`flex-1 min-w-[140px] rounded-xl border px-4 py-3 text-left text-sm transition-all ${
              activeLocale === locale
                ? "border-primary bg-primary/10 text-foreground"
                : "border-card-border bg-background text-muted hover:bg-card-elevated hover:text-foreground"
            } ${isPending ? "opacity-60" : ""}`}
          >
            <span className="block font-medium">{LOCALE_LABELS[locale]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
