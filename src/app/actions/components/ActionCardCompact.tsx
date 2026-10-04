"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { campaignAnchorToLocal } from "@/lib/campaigns/rules/currency";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import {
  calculateConvertCashInfamy,
  convertCashConversion,
  isFundraiseEligible,
} from "@/lib/actions";
import { CATEGORY_LABELS } from "../actionsConstants";

const FLIPFLOP_AXIS_LABELS = { economic: "Economic", social: "Social" } as const;
const NEUTRAL_BUTTON =
  "rounded-md border border-card-border bg-card-elevated text-foreground transition-colors hover:bg-card-muted";
import type { ActionCardProps } from "../actionsTypes";
import ActionExecuteRow from "./ActionExecuteRow";

const ActionCardCompact = memo(function ActionCardCompact({
  card,
  character,
  homeState,
  executing,
  flash: _flash,
  flipflopStep,
  flipflopAxis,
  flipflopDir,
  onExecute,
  onOpenCampaignAction,
  onFlipflop,
  onFlipflopStepChange,
  onFlipflopAxisChange,
  onFlipflopDirChange,
  campaignActionCost,
  campaignFundCost,
  campaignMaxed,
  advertiseActionCost,
  advertiseFundCost,
  fundraiseActionCost,
  buildDonorBaseActionCost,
  buildDonorBaseFundCost,
  fundraiseYield,
  campaignCurrency,
  displayCampaignFunds,
  displayPersonalWealth,
  blockGdpScaledCosts,
  forexEnabled,
  convertCashOpen,
  convertCashAmount,
  onConvertCashOpenChange,
  onConvertCashAmountChange,
  onConvertCashExecute,
}: ActionCardProps) {
  const {
    formatAmount,
    baseRates,
    toDisplay,
    toInternal,
    toInternalFrom,
    toLocalOf,
    currencyCode,
    inputSymbol,
  } = useCurrency();
  const personalAnchor = forexEnabled
    ? toInternalFrom(displayPersonalWealth, currencyCode)
    : displayPersonalWealth;
  const politicalLocal = (amount: number) =>
    forexEnabled ? campaignAnchorToLocal(amount, character.countryId ?? "US", baseRates) : amount;
  // Self-funding confirm step: acknowledge the Infamy cost before submitting.
  const [convertConfirming, setConvertConfirming] = useState(false);
  const isCampaign = card.type === "campaign";
  const isAdvertise = card.type === "advertise";
  const isFundraise = card.type === "fundraise";
  const isBuildDonorBase = card.type === "buildDonorBase";
  const isConvertCash = card.type === "convertCash";
  const isGdpScaledAction = isCampaign || isAdvertise || isBuildDonorBase;
  const gdpCostsBlocked = isGdpScaledAction && blockGdpScaledCosts;

  let effectiveActionCost: number;
  if (isCampaign) effectiveActionCost = campaignActionCost;
  else if (isAdvertise) effectiveActionCost = advertiseActionCost;
  else if (isFundraise) effectiveActionCost = fundraiseActionCost;
  else if (isBuildDonorBase) effectiveActionCost = buildDonorBaseActionCost;
  else effectiveActionCost = card.actionCost;

  let effectiveFundCost: number | null;
  if (isCampaign) effectiveFundCost = campaignFundCost;
  else if (isAdvertise) effectiveFundCost = advertiseFundCost;
  else if (isBuildDonorBase) effectiveFundCost = buildDonorBaseFundCost;
  else effectiveFundCost = card.fundCost(character);

  let effectiveFundLabel: string;
  if (isCampaign)
    effectiveFundLabel = formatCurrencyFaceAmount(
      politicalLocal(campaignFundCost),
      campaignCurrency
    );
  else if (isAdvertise)
    effectiveFundLabel = formatCurrencyFaceAmount(
      politicalLocal(advertiseFundCost),
      campaignCurrency
    );
  else if (isBuildDonorBase)
    effectiveFundLabel = formatCurrencyFaceAmount(
      politicalLocal(buildDonorBaseFundCost),
      campaignCurrency
    );
  else if (isFundraise)
    effectiveFundLabel = `+${formatCurrencyFaceAmount(fundraiseYield, campaignCurrency)}`;
  else if (isConvertCash) {
    effectiveFundLabel =
      displayPersonalWealth > 0 ? `${formatAmount(personalAnchor)} available` : "No cash";
  } else effectiveFundLabel = card.fundLabel(character);

  const noDonor = card.requiresDonorBase && !isFundraiseEligible(character.donorBaseLevel);
  const noCash = isConvertCash && displayPersonalWealth <= 0;
  const fundNeeded = effectiveFundCost;
  const fundNeededConverted = fundNeeded !== null ? politicalLocal(fundNeeded) : fundNeeded;
  const cantAffordFunds =
    fundNeededConverted !== null && displayCampaignFunds < fundNeededConverted;
  const cantAffordActions = character.actions < effectiveActionCost;
  const isMaxed = isCampaign && campaignMaxed;
  const blocked =
    gdpCostsBlocked || isMaxed || noDonor || noCash || cantAffordFunds || cantAffordActions;

  const isFlipflop = card.type === "flipflop";

  // Warning text
  let warningText = "";
  if (gdpCostsBlocked) warningText = "State costs unavailable";
  else if (isMaxed) warningText = "Influence maxed";
  else if (noDonor) warningText = "No donor network";
  else if (noCash) warningText = "No cash";
  else if (cantAffordFunds) warningText = "Insufficient funds";
  else if (cantAffordActions) warningText = "Insufficient AP";

  return (
    <div
      data-coach={`action-${card.type}`}
      className={`rounded-lg border border-card-border bg-card ${blocked ? "opacity-60" : ""}`}
    >
      {/* One column on phones; on wider screens the buttons sit in a fixed right column */}
      <div className="grid grid-cols-1 gap-3 px-3 py-3 sm:grid-cols-[1fr_auto] sm:gap-4 sm:px-4">
        {/* Left column: name, category, effect and costs */}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-body font-semibold text-foreground">{card.label}</span>
            <span className="text-body-sm text-muted">{CATEGORY_LABELS[card.category]}</span>
            {warningText && (
              <span className="text-body-sm font-medium text-error">{warningText}</span>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-body-sm">
            <span className="text-muted">{card.effect}</span>
            <span className="font-medium tabular-nums text-foreground">
              <span className={cantAffordActions ? "text-error" : ""}>
                {effectiveActionCost} AP
              </span>
              <span className="mx-1 text-muted" aria-hidden>
                ·
              </span>
              <span className={cantAffordFunds ? "text-error" : isFundraise ? "text-success" : ""}>
                {effectiveFundLabel}
              </span>
            </span>
          </div>
        </div>

        {/* Right column: button row — always right aligned */}
        <div className="flex items-center justify-start sm:justify-end">
          {(card.type === "canvass" || card.type === "targetedAds") && onOpenCampaignAction ? (
            <button
              type="button"
              onClick={() => onOpenCampaignAction(card.type as "canvass" | "targetedAds")}
              className="w-full rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-sm font-semibold transition-colors hover:bg-card-muted"
            >
              {card.label}
            </button>
          ) : card.href ? (
            <Link
              href={card.href}
              className={`inline-flex w-full items-center justify-center gap-1 px-2.5 py-1.5 text-body-sm font-semibold sm:w-auto ${NEUTRAL_BUTTON}`}
            >
              View
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          ) : isFlipflop ? (
            <div className="flex items-center gap-1 flex-wrap sm:flex-nowrap">
              {flipflopStep === null && (
                <button
                  onClick={() => onFlipflopStepChange("axis")}
                  disabled={blocked || !!executing}
                  className={`w-full px-2.5 py-1.5 text-body-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${NEUTRAL_BUTTON}`}
                >
                  Flip-flop
                </button>
              )}
              {flipflopStep === "axis" && (
                <div className="flex items-center gap-1 animate-in slide-in-from-right-2 duration-200 flex-wrap sm:flex-nowrap">
                  {(["economic", "social"] as const).map((ax) => (
                    <button
                      key={ax}
                      onClick={() => {
                        onFlipflopAxisChange(ax);
                        onFlipflopStepChange("direction");
                      }}
                      className={`flex-1 px-2 py-1.5 text-body-sm font-semibold sm:flex-none ${NEUTRAL_BUTTON}`}
                    >
                      {FLIPFLOP_AXIS_LABELS[ax]}
                    </button>
                  ))}
                  <button
                    onClick={() => onFlipflopStepChange(null)}
                    aria-label="Cancel"
                    className="px-1 text-body-sm text-muted hover:text-foreground"
                  >
                    X
                  </button>
                </div>
              )}
              {flipflopStep === "direction" && flipflopAxis && (
                <div className="flex items-center gap-1 animate-in slide-in-from-right-2 duration-200 flex-wrap sm:flex-nowrap">
                  {(
                    [
                      [-1, "Left"],
                      [1, "Right"],
                    ] as const
                  ).map(([dir, label]) => (
                    <button
                      key={dir}
                      onClick={() => onFlipflopDirChange(dir)}
                      aria-pressed={flipflopDir === dir}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-body-sm font-semibold transition-colors sm:flex-none ${
                        flipflopDir === dir
                          ? "border-foreground/50 bg-card-muted text-foreground"
                          : "border-card-border bg-card-elevated text-foreground hover:bg-card-muted"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {flipflopDir !== null && (
                    <button
                      onClick={() => onFlipflop(flipflopAxis, flipflopDir)}
                      disabled={!!executing}
                      className="rounded-md bg-error px-2 py-1.5 text-body-sm font-semibold text-white transition-colors hover:bg-error-muted disabled:opacity-50"
                    >
                      {executing === "flipflop" ? "..." : "Go"}
                    </button>
                  )}
                  <button
                    onClick={() => onFlipflopStepChange(null)}
                    aria-label="Cancel"
                    className="px-1 text-body-sm text-muted hover:text-foreground"
                  >
                    X
                  </button>
                </div>
              )}
            </div>
          ) : isConvertCash ? (
            <div className="flex items-center gap-1 flex-wrap sm:flex-nowrap">
              {!convertCashOpen && (
                <button
                  onClick={() => onConvertCashOpenChange(true)}
                  disabled={blocked || !!executing}
                  className={`w-full px-2.5 py-1.5 text-body-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${NEUTRAL_BUTTON}`}
                >
                  Donate
                </button>
              )}
              {convertCashOpen &&
                (() => {
                  const cash = Math.floor(toDisplay(personalAnchor));
                  const parsed = Number(convertCashAmount) || 0;
                  const localDonation = Math.round(toLocalOf(parsed, currencyCode));
                  const valid =
                    parsed > 0 &&
                    parsed <= cash &&
                    localDonation > 0 &&
                    localDonation <= displayPersonalWealth;
                  const previewInfamy = valid
                    ? calculateConvertCashInfamy(Math.round(toInternal(parsed)))
                    : 0;
                  // Shared conversion leg: the preview credits exactly what execution debits.
                  const previewFunds = valid
                    ? toInternalFrom(convertCashConversion(localDonation), currencyCode)
                    : 0;
                  return (
                    <div className="flex items-center gap-1 animate-in slide-in-from-right-2 duration-200 flex-wrap sm:flex-nowrap">
                      <div className="relative flex-1 sm:flex-none">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-body-sm text-muted">
                          {inputSymbol}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={cash}
                          value={convertCashAmount}
                          onChange={(e) => onConvertCashAmountChange(e.target.value)}
                          placeholder="Amt"
                          className="w-full rounded-md border border-card-border bg-card-elevated py-1.5 pl-5 pr-2 text-body-sm font-medium text-foreground placeholder:text-muted/60 focus:border-foreground/40 focus:outline-none sm:w-24"
                        />
                      </div>
                      {valid && (
                        <span className="whitespace-nowrap text-body-sm text-muted">
                          <span className="text-success">+{formatAmount(previewFunds)}</span> /{" "}
                          <span className="text-error">+{previewInfamy}% inf</span>
                        </span>
                      )}
                      {valid && !convertConfirming && (
                        <button
                          onClick={() => setConvertConfirming(true)}
                          disabled={!!executing}
                          className="rounded-md bg-primary px-2 py-1.5 text-body-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
                        >
                          {executing === "convertCash" ? "..." : "Go"}
                        </button>
                      )}
                      {valid && convertConfirming && (
                        <button
                          onClick={() => {
                            setConvertConfirming(false);
                            onConvertCashExecute(localDonation);
                          }}
                          disabled={!!executing}
                          title={`Self-funding raises Infamy by +${previewInfamy}%. Infamy decays 5% per turn.`}
                          className="whitespace-nowrap rounded-md bg-error px-2 py-1.5 text-body-sm font-semibold text-white transition-colors hover:bg-error-muted disabled:opacity-50"
                        >
                          {executing === "convertCash" ? "..." : `+${previewInfamy}% inf, sure?`}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setConvertConfirming(false);
                          onConvertCashOpenChange(false);
                        }}
                        aria-label="Cancel"
                        className="px-1 text-body-sm text-muted hover:text-foreground"
                      >
                        X
                      </button>
                    </div>
                  );
                })()}
            </div>
          ) : (
            <ActionExecuteRow
              actionType={card.type}
              character={character}
              homeState={homeState}
              blocked={blocked}
              executingKey={executing}
              onExecute={onExecute}
              compact
              forexEnabled={forexEnabled}
            />
          )}
        </div>
      </div>
    </div>
  );
});

export default ActionCardCompact;
