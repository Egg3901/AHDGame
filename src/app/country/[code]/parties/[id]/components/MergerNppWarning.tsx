"use client";

import { useTranslations } from "next-intl";

/** The same permanent-deletion notice appears before proposing and on both ballots. */
export function MergerNppWarning() {
  const t = useTranslations("elections.mergerNppWarning");
  return (
    <aside
      role="note"
      aria-label={t("title")}
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2 text-xs"
    >
      <p className="font-semibold text-amber-600 dark:text-amber-300">{t("title")}</p>
      <p>{t("priority")}</p>
      <p>{t("regional")}</p>
      <p>{t("national")}</p>
      <p>{t("selection")}</p>
      <p className="font-medium">{t("consequence")}</p>
    </aside>
  );
}
