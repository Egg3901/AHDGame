"use client";

import { useTranslations } from "next-intl";

interface Entry {
  turn: number;
  previous: number;
  next: number;
  delta: number;
  reason: string;
}

export function RegimeChangeHistory({ entries }: { entries: readonly Entry[] }) {
  const t = useTranslations("profile.regimeChanges");
  const recent = entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.turn - a.turn || b.index - a.index)
    .slice(0, 12);
  return (
    <details className="rounded-lg border border-card-border p-3 text-xs">
      <summary className="cursor-pointer font-semibold">{t("title")}</summary>
      <p className="mt-2 text-muted">{t("description")}</p>
      {recent.length === 0 ? (
        <p className="mt-2 text-muted">{t("empty")}</p>
      ) : (
        <ol className="mt-2 space-y-3">
          {recent.map((entry) => (
            <li key={entry.index}>
              <p className="font-medium">
                {t("turn", { turn: entry.turn })}:{" "}
                <span
                  className={
                    entry.delta < 0 ? "text-error" : entry.delta > 0 ? "text-success" : "text-muted"
                  }
                >
                  {entry.delta > 0 ? "+" : ""}
                  {entry.delta.toFixed(2)}
                </span>{" "}
                ({entry.previous.toFixed(2)} → {entry.next.toFixed(2)})
              </p>
              <p className="mt-1 break-words text-muted">{entry.reason.trim() || t("unknown")}</p>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
