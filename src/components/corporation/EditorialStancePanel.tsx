"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiErrorText } from "@/lib/errors/catalog";
import { DenseSection, InlineStatus, SmallButton } from "./dense/DenseKit";

export interface EditorialStanceView {
  economic: number;
  social: number;
}

export function EditorialStancePanel({
  corporationId,
  stance,
  isCeo,
  onSaved,
}: {
  corporationId: string;
  stance?: EditorialStanceView;
  isCeo: boolean;
  onSaved?: () => void;
}) {
  const t = useTranslations("corporations.editorialStance");
  const [economic, setEconomic] = useState(stance?.economic ?? 0);
  const [social, setSocial] = useState(stance?.social ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/corporations/${corporationId}/editorial-stance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ economic, social }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(apiErrorText(body, t("saveFailed")));
        return;
      }
      onSaved?.();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const changed = economic !== (stance?.economic ?? 0) || social !== (stance?.social ?? 0);
  const axes = [
    {
      key: "economic",
      value: economic,
      set: setEconomic,
      low: t("economicLow"),
      high: t("economicHigh"),
    },
    { key: "social", value: social, set: setSocial, low: t("socialLow"), high: t("socialHigh") },
  ] as const;

  return (
    <DenseSection
      id="editorial-stance"
      title={t("title")}
      meta={t("published", {
        economic: stanceValue(stance?.economic ?? 0),
        social: stanceValue(stance?.social ?? 0),
      })}
    >
      <p className="py-1 text-sm text-muted">{t("description")}</p>
      <div className="grid gap-4 py-2 sm:grid-cols-2">
        {axes.map((axis) => (
          <label key={axis.key} className="grid gap-1 text-sm">
            <span>
              {t(axis.key)}: <span className="font-mono">{stanceValue(axis.value)}</span>
            </span>
            <input
              type="range"
              min={-5}
              max={5}
              step={1}
              value={axis.value}
              disabled={!isCeo || saving}
              onChange={(event) => axis.set(Number(event.target.value))}
              aria-label={t(axis.key)}
            />
            <span className="flex justify-between text-xs text-muted">
              <span>{axis.low}</span>
              <span>{axis.high}</span>
            </span>
          </label>
        ))}
      </div>
      {isCeo ? (
        <div className="flex flex-wrap items-center gap-3">
          <SmallButton
            tone="primary"
            disabled={saving || !changed}
            title={!changed ? t("unchanged") : undefined}
            onClick={() => void save()}
          >
            {saving ? t("saving") : t("save")}
          </SmallButton>
          {!changed && <span className="text-xs text-muted">{t("unchanged")}</span>}
        </div>
      ) : (
        <p className="text-xs text-muted">{t("ceoOnly")}</p>
      )}
      <InlineStatus message={error} tone="error" className="pt-2" />
    </DenseSection>
  );
}

function stanceValue(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}
