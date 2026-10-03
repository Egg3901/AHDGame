"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import { MailComposerModal } from "@/components/MailComposerModal";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "actions" | "funds" | "mail";

interface InfluenceInfo {
  canInfluence: boolean;
  actionCost: number;
  multiplier: number;
  myActions: number;
  myFunds: number;
  myHomeState: string;
  targetHomeState: string;
  targetInfluence: number;
  targetFavorability: number;
  myInfamy: number;
  attackFailureChance: number;
  targetMediaSustainedAtCap: boolean;
}

interface InteractCardProps {
  targetId: string;
  targetName: string;
  targetInfluence: number;
  myFunds: number; // viewer's campaign funds for the transfer tab
  myCash: number; // viewer's cash on hand for the wire tab
  canInfluence: boolean;
}

// ─── Inline bar ──────────────────────────────────────────────────────────────

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid grid-cols-[100px_1fr_52px] items-center gap-3">
      <span className="text-body-sm text-muted">{label}</span>
      <div className="h-1 w-full overflow-hidden bg-card-border/60">
        <div
          className="h-full bg-foreground/60"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-right text-body-sm font-semibold tabular-nums text-foreground">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Actions tab ─────────────────────────────────────────────────────────────

function ActionsTab({
  targetId,
  initialInfluence,
}: {
  targetId: string;
  targetName: string;
  initialInfluence: number;
}) {
  const t = useTranslations("profile.interact");
  const { formatAmount } = useCurrency();
  const [info, setInfo] = useState<InfluenceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [flash, setFlash] = useState<"raise" | "lower" | "barnstorm" | "failed" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [influence, setInfluence] = useState(initialInfluence);
  const [favorability, setFavorability] = useState(50);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${targetId}/influence`);
      if (res.ok) {
        const data = await res.json();
        setInfo(data);
        setInfluence(data.targetInfluence);
        setFavorability(data.targetFavorability);
      }
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  const execute = async (action: "raise" | "lower" | "barnstorm") => {
    if (!info || executing) return;
    setExecuting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/characters/${targetId}/influence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        setInfluence(data.newTargetInfluence);
        setFavorability(data.newTargetFavorability);
        const newInfamy = data.myCharacter.infamy || 0;
        setInfo((prev) =>
          prev
            ? {
                ...prev,
                myActions: data.myCharacter.actions,
                // LOCAL home-currency balance (canonical source of truth).
                myFunds: data.myCharacter.currencyBalances?.campaign ?? data.myCharacter.funds ?? 0,
                myInfamy: newInfamy,
                attackFailureChance: newInfamy,
              }
            : null
        );
        setFlash(data.attackFailed ? "failed" : action);
        setTimeout(() => setFlash(null), 1500);
      } else {
        setActionError(data.error || t("actionFailed"));
      }
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-3 bg-card-elevated rounded w-2/3" />
        <div className="h-3 bg-card-elevated rounded w-1/2" />
        <div className="h-8 bg-card-elevated rounded" />
      </div>
    );
  }

  if (!info) return <p className="text-body-sm text-muted">{t("loadError")}</p>;

  const canAction = info.myActions >= info.actionCost;
  const favorabilityMaxed = favorability >= 100;
  const favorabilityFloored = favorability <= 0;
  const influenceMaxed = influence >= 100;
  const canBarnstorm = info.myActions >= 5 && info.myFunds >= 100_000 && !influenceMaxed;
  const sameState = info.myHomeState === info.targetHomeState;

  const locationLabel =
    info.multiplier === 1.0
      ? t("sameState")
      : info.multiplier === 1.25
        ? t("neighboringState")
        : t("distantState");

  const btnBase =
    "flex flex-col items-center gap-0.5 rounded-md border px-3 py-2.5 text-body-sm font-semibold text-foreground transition-colors hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-4">
      {/* Target stats */}
      <div className="space-y-2.5">
        <StatBar label={t("influence")} value={influence} />
        <StatBar label={t("favorability")} value={favorability} />
      </div>

      {/* Resources & location */}
      <div className="space-y-1 border-y border-card-border/60 py-2 text-body-sm">
        <div className="flex justify-between text-muted">
          <span>{t("location")}</span>
          <span className="text-foreground">
            {locationLabel} · {t("actionCost", { count: info.actionCost })}
          </span>
        </div>
        <div className="flex justify-between text-muted">
          <span>{t("yourResources")}</span>
          <span className="text-foreground tabular-nums">
            {t("actionsCount", { count: info.myActions })} · {formatAmount(info.myFunds)}
          </span>
        </div>
      </div>

      {/* Support / Attack */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => execute("raise")}
          disabled={!canAction || favorabilityMaxed || executing || flash !== null}
          title={
            favorabilityMaxed && info.targetMediaSustainedAtCap
              ? t("supportTitleMediaCap")
              : favorabilityMaxed
                ? t("supportTitleMaxed")
                : undefined
          }
          className={`${btnBase} ${flash === "raise" ? "border-success" : "border-card-border"}`}
        >
          <span>{flash === "raise" ? t("supported") : t("support")}</span>
          <span
            className={`text-body-xs font-normal ${favorabilityMaxed ? "text-muted" : "text-success"}`}
          >
            {favorabilityMaxed
              ? info.targetMediaSustainedAtCap
                ? t("pinnedByMedia")
                : t("maxed")
              : t("plusFav")}
          </span>
        </button>

        <button
          onClick={() => execute("lower")}
          disabled={!canAction || favorabilityFloored || executing || flash !== null}
          className={`${btnBase} ${
            flash === "failed"
              ? "border-warning"
              : flash === "lower"
                ? "border-error"
                : "border-card-border"
          }`}
        >
          {flash === "failed" ? (
            <>
              <span>{t("blocked")}</span>
              <span className="text-body-xs font-normal text-warning">{t("infamyBlocked")}</span>
            </>
          ) : (
            <>
              <span>{flash === "lower" ? t("attacked") : t("attack")}</span>
              <span
                className={`text-body-xs font-normal ${favorabilityFloored ? "text-muted" : "text-error"}`}
              >
                {favorabilityFloored
                  ? t("atFloor")
                  : info.attackFailureChance > 0
                    ? t("attackEffectWithFail", { pct: Math.round(info.attackFailureChance) })
                    : t("attackEffect")}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Barnstorm */}
      <button
        onClick={() => execute("barnstorm")}
        disabled={!canBarnstorm || executing || flash !== null}
        className={`w-full ${btnBase} ${
          flash === "barnstorm" ? "border-foreground" : "border-card-border"
        }`}
      >
        <span>{flash === "barnstorm" ? t("barnstormed") : t("barnstorm")}</span>
        <span className="text-body-xs font-normal text-muted">
          {influenceMaxed
            ? t("influenceMaxed")
            : t("barnstormEffect", {
                gain: sameState ? "+2%" : "+1%",
                amount: formatAmount(100_000),
              })}
        </span>
      </button>

      {!canAction && <p className="text-center text-body-xs text-error">{t("notEnoughActions")}</p>}
      {actionError && <p className="text-center text-body-xs text-error">{actionError}</p>}
    </div>
  );
}

// ─── Funds tab ────────────────────────────────────────────────────────────────

function FundsTab({
  targetId,
  targetName,
  myFunds,
  myCash,
}: {
  targetId: string;
  targetName: string;
  myFunds: number;
  myCash: number;
}) {
  const t = useTranslations("profile.interact");
  const locale = useLocale();
  const { inputSymbol } = useCurrency();
  const [mode, setMode] = useState<"campaign" | "cash">("campaign");
  // Input value is in the sender's LOCAL home currency (matches the input symbol).
  const [displayAmount, setDisplayAmount] = useState(10_000);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Balances and the amount input are all in the sender's LOCAL home currency.
  const availableLocal = mode === "campaign" ? myFunds : myCash;
  const maxDisplayTransfer = useMemo(() => Math.max(0, availableLocal), [availableLocal]);

  const switchMode = (next: "campaign" | "cash") => {
    setMode(next);
    setMessage(null);
    setError(null);
    setDisplayAmount(10_000);
  };

  const submit = async () => {
    setError(null);
    setMessage(null);
    // Both /transfer (campaign funds) and /wire (cash on hand) accept amounts in
    // the sender's LOCAL home currency — pass the typed amount through unchanged.
    const amount = Math.round(displayAmount);
    if (!amount || amount <= 0) {
      setError(t("enterValidAmount"));
      return;
    }
    setSubmitting(true);
    try {
      const endpoint =
        mode === "campaign"
          ? `/api/characters/${targetId}/transfer`
          : `/api/characters/${targetId}/wire`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("transferFailed"));
        return;
      }
      // Both routes echo back the amount they applied, already in local units.
      const successText = t("sent", {
        amount: `${inputSymbol}${Number(data.amount ?? amount).toLocaleString(locale)}`,
        name: targetName,
      });
      setMessage(successText);
    } catch {
      setError(t("transferFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const modeBtn = (m: "campaign" | "cash", _label: string) =>
    `flex-1 rounded px-2 py-1 text-body-sm font-medium transition-colors ${
      mode === m ? "bg-card-elevated text-foreground" : "text-muted hover:text-foreground"
    }`;

  return (
    <div className="space-y-3">
      {/* Campaign / Cash toggle */}
      <div className="inline-flex w-full rounded-md border border-card-border p-0.5">
        <button
          type="button"
          className={modeBtn("campaign", "Campaign")}
          onClick={() => switchMode("campaign")}
        >
          {t("modeCampaign")}
        </button>
        <button
          type="button"
          className={modeBtn("cash", "Cash")}
          onClick={() => switchMode("cash")}
        >
          {t("modeCash")}
        </button>
      </div>

      <div className="flex justify-between border-y border-card-border/60 py-2 text-body-sm text-muted">
        <span>{mode === "campaign" ? t("yourCampaignFunds") : t("yourCashOnHand")}</span>
        <span className="font-semibold text-foreground tabular-nums">
          {inputSymbol}
          {Math.round(availableLocal).toLocaleString(locale)}
        </span>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="interact-transfer-amount" className="text-body-sm text-muted">
          {t("amountLabel", { symbol: inputSymbol })}
        </label>
        <input
          id="interact-transfer-amount"
          type="number"
          min={0}
          max={maxDisplayTransfer}
          step={1}
          value={displayAmount}
          onChange={(e) => setDisplayAmount(Number(e.target.value))}
          className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-body text-foreground focus:border-foreground/40 focus:outline-none"
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting || displayAmount <= 0 || displayAmount > maxDisplayTransfer}
        className="w-full rounded-md bg-primary px-3 py-2 text-body font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? t("sending")
          : t("send", {
              amount: `${inputSymbol}${Math.round(Math.max(0, displayAmount || 0)).toLocaleString(locale)}`,
            })}
      </button>

      {message && <p className="text-body-sm text-foreground">{message}</p>}
      {error && <p className="text-body-sm text-error">{error}</p>}
    </div>
  );
}

// ─── Mail tab ─────────────────────────────────────────────────────────────────

function MailTab({
  toCharacterId,
  toCharacterName,
}: {
  toCharacterId: string;
  toCharacterName: string;
}) {
  const t = useTranslations("profile.interact");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-md bg-primary px-3 py-2.5 text-body font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {t("composeMail", { name: toCharacterName })}
      </button>

      {open && (
        <MailComposerModal
          mode={{ type: "mail", toCharacterId, toCharacterName }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─── InteractCard ─────────────────────────────────────────────────────────────

export function InteractCard({
  targetId,
  targetName,
  targetInfluence,
  myFunds,
  myCash,
  canInfluence,
}: InteractCardProps) {
  const t = useTranslations("profile.interact");
  const [tab, setTab] = useState<Tab>("actions");

  const tabClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-body-sm font-medium transition-colors ${
      active ? "bg-card-elevated text-foreground" : "text-muted hover:text-foreground"
    }`;

  return (
    <div className="rounded-md border border-card-border p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-body-lg font-semibold text-foreground">{t("title")}</h2>
        <div
          className="inline-flex rounded-md border border-card-border p-0.5"
          role="tablist"
          aria-label={t("tablistAria")}
        >
          {canInfluence && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "actions"}
              className={tabClass(tab === "actions")}
              onClick={() => setTab("actions")}
            >
              {t("tabActions")}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={tab === "funds"}
            className={tabClass(tab === "funds")}
            onClick={() => setTab("funds")}
          >
            {t("tabFunds")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mail"}
            className={tabClass(tab === "mail")}
            onClick={() => setTab("mail")}
          >
            {t("tabMail")}
          </button>
        </div>
      </div>

      {tab === "actions" && canInfluence && (
        <ActionsTab
          targetId={targetId}
          targetName={targetName}
          initialInfluence={targetInfluence}
        />
      )}

      {tab === "funds" && (
        <FundsTab targetId={targetId} targetName={targetName} myFunds={myFunds} myCash={myCash} />
      )}

      {tab === "mail" && <MailTab toCharacterId={targetId} toCharacterName={targetName} />}
    </div>
  );
}
