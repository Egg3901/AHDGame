"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PolicyShiftControl } from "@/components/PolicyShiftControl";
import { MessageBanner } from "./shared";

interface CharacterPolicies {
  economic: number;
  social: number;
}

interface CharacterData {
  actions: number;
  infamy: number;
  politicalInfluence: number;
  nationalInfluence?: number;
  policies: CharacterPolicies;
  autoRunForReelection?: boolean;
}

interface Props {
  character: CharacterData;
  onCharacterUpdate: (updates: Partial<CharacterData>) => void;
  onReelectionChange: (value: boolean) => void;
}

export function PoliticsSection({ character, onCharacterUpdate, onReelectionChange }: Props) {
  const t = useTranslations("settings");
  const [policyMsg, setPolicyMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const handlePolicyShift = async (axis: "economic" | "social", direction: -1 | 1) => {
    setPolicyMsg(null);
    try {
      const res = await fetch("/api/settings/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ axis, direction }),
      });
      const data = await res.json();
      if (res.ok) {
        setPolicyMsg({ text: t("politics.shifted"), ok: true });
        if (data.stats) {
          onCharacterUpdate({
            policies: data.stats.policies,
            actions: data.stats.actions,
            infamy: data.stats.infamy,
            politicalInfluence: data.stats.politicalInfluence,
            nationalInfluence: data.stats.nationalInfluence,
          });
        }
      } else {
        setPolicyMsg({ text: data.error ?? t("politics.shiftFailed"), ok: false });
      }
    } catch {
      setPolicyMsg({ text: t("common.networkError"), ok: false });
    } finally {
      setTimeout(() => setPolicyMsg(null), 5000);
    }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <span className="rounded-full bg-secondary/15 px-3 py-1 text-sm font-medium text-secondary">
          {t("politics.actionsCount", { count: character.actions })}
        </span>
      </div>
      <p className="text-sm text-muted mb-6">{t("politics.intro")}</p>
      {policyMsg && (
        <MessageBanner
          ok={policyMsg.ok}
          text={policyMsg.text}
          onDismiss={() => setPolicyMsg(null)}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <PolicyShiftControl
          axis="economic"
          value={character.policies.economic}
          currentActions={character.actions}
          onShift={handlePolicyShift}
        />
        <PolicyShiftControl
          axis="social"
          value={character.policies.social}
          currentActions={character.actions}
          onShift={handlePolicyShift}
        />
      </div>

      <div className="border-t border-card-border pt-6 mt-6">
        <h3 className="text-sm font-medium mb-3">{t("politics.electionPreferences")}</h3>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={character.autoRunForReelection ?? false}
            onChange={(e) => onReelectionChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-card-border bg-background text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <span className="text-sm text-foreground group-hover:text-primary transition-colors">
              {t("politics.autoReelection")}
            </span>
            <p className="mt-0.5 text-xs text-muted">{t("politics.autoReelectionHint")}</p>
          </div>
        </label>
      </div>
    </>
  );
}
