"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { calculateConvertCashInfamy } from "@/lib/actions";
import { CATEGORY_ACCENTS, CATEGORY_LABELS } from "../actionsConstants";
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
  const { formatAmount, convert, forexRates } = useCurrency();
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
  if (isCampaign) effectiveFundLabel = formatAmount(campaignFundCost);
  else if (isAdvertise) effectiveFundLabel = formatAmount(advertiseFundCost);
  else if (isBuildDonorBase) effectiveFundLabel = formatAmount(buildDonorBaseFundCost);
  else if (isFundraise) effectiveFundLabel = `+${formatAmount(fundraiseYield)}`;
  else if (isConvertCash) {
    effectiveFundLabel =
      displayPersonalWealth > 0 ? `${formatAmount(displayPersonalWealth)} available` : "No cash";
  } else effectiveFundLabel = card.fundLabel(character);

  const noDonor = card.requiresDonorBase && (character.donorBaseLevel ?? 0) === 0;
  const noCash = isConvertCash && displayPersonalWealth <= 0;
  const fundNeeded = effectiveFundCost;
  const fundNeededConverted =
    fundNeeded !== null && forexEnabled && forexRates ? convert(fundNeeded) : fundNeeded;
  const cantAffordFunds =
    fundNeededConverted !== null && displayCampaignFunds < fundNeededConverted;
  const cantAffordActions = character.actions < effectiveActionCost;
  const isMaxed = isCampaign && campaignMaxed;
  const blocked =
    gdpCostsBlocked || isMaxed || noDonor || noCash || cantAffordFunds || cantAffordActions;
  const accent = CATEGORY_ACCENTS[card.category] ?? CATEGORY_ACCENTS.influence;

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
      className={`group relative overflow-hidden rounded-lg border border-card-border transition-all duration-200 hover:border-primary/40
        ${blocked ? "opacity-60" : ""}
      `}
    >
      {/* Color-only background (no photo — category accent, see CATEGORY_ACCENTS.row) */}
      <div
        className={`absolute inset-0 z-0 bg-gradient-to-r ${accent.row} transition-opacity duration-200 group-hover:opacity-95`}
      />
      <div className="absolute inset-0 z-0 bg-black/40 transition-colors duration-200 group-hover:bg-black/32" />

      {/* Mobile layout: stacked rows */}
      {/* Desktop layout: grid with fixed columns for consistent button alignment */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:gap-4 px-3 py-3 sm:px-4 sm:py-3">
        {/* Left column: badge + name + effect + costs */}
        <div className="flex flex-col gap-1.5 min-w-0">
          {/* Top sub-row: badge + name */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Category badge — mobile */}
            <span className="inline-flex sm:hidden w-[56px] justify-center shrink-0 items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/70">
              {CATEGORY_LABELS[card.category]}
            </span>
            {/* Category badge — desktop */}
            <span className="hidden sm:inline-flex w-[72px] justify-center shrink-0 items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/70">
              {CATEGORY_LABELS[card.category]}
            </span>
            <span className="font-semibold text-sm text-white">{card.label}</span>
            {warningText && (
              <span className="text-[10px] font-medium text-red-400">{warningText}</span>
            )}
          </div>
          {/* Bottom sub-row: effect + costs */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/50">{card.effect}</span>
            {/* Costs inline on mobile */}
            <span className="sm:hidden text-[10px] text-white/60">
              <span className={cantAffordActions ? "text-red-400" : ""}>
                {effectiveActionCost} AP
              </span>
              <span className="text-white/30 mx-1">·</span>
              <span className={cantAffordFunds ? "text-red-400" : ""}>{effectiveFundLabel}</span>
            </span>
          </div>
          {/* Desktop costs — separate row for alignment */}
          <div className="hidden sm:flex items-center gap-3 text-xs">
            <span
              className={`font-medium tabular-nums ${cantAffordActions ? "text-red-400" : "text-white/90"}`}
            >
              {effectiveActionCost} AP
            </span>
            <span className="text-white/30">/</span>
            <span
              className={`font-medium tabular-nums ${cantAffordFunds ? "text-red-400" : "text-white/90"}`}
            >
              {effectiveFundLabel}
            </span>
          </div>
        </div>

        {/* Right column: button row — always right aligned */}
        <div className="flex items-center justify-start sm:justify-end">
          {card.href ? (
            <Link
              href={card.href}
              className="inline-flex items-center justify-center gap-1 w-full sm:w-auto rounded-md border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 hover:border-white/30 transition-all backdrop-blur-sm"
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
                  className="rounded-md border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 transition-all backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
                >
                  Flip-Flop
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
                      className="rounded-md border border-white/15 bg-white/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-white/20 hover:border-white/30 transition-all backdrop-blur-sm flex-1 sm:flex-none"
                    >
                      {ax.slice(0, 4)}
                    </button>
                  ))}
                  <button
                    onClick={() => onFlipflopStepChange(null)}
                    className="text-[10px] text-white/50 hover:text-white px-1"
                  >
                    X
                  </button>
                </div>
              )}
              {flipflopStep === "direction" && flipflopAxis && (
                <div className="flex items-center gap-1 animate-in slide-in-from-right-2 duration-200 flex-wrap sm:flex-nowrap">
                  {(
                    [
                      [-1, "L"],
                      [1, "R"],
                    ] as const
                  ).map(([dir, label]) => (
                    <button
                      key={dir}
                      onClick={() => onFlipflopDirChange(dir)}
                      className={`rounded-md border px-2 py-1.5 text-[10px] font-bold uppercase transition-all backdrop-blur-sm flex-1 sm:flex-none ${
                        flipflopDir === dir
                          ? "bg-red-500/30 border-red-500 text-red-300"
                          : "border-white/15 bg-white/10 hover:bg-white/20"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {flipflopDir !== null && (
                    <button
                      onClick={() => onFlipflop(flipflopAxis, flipflopDir)}
                      disabled={!!executing}
                      className="rounded-md bg-red-600 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-red-500 transition-all disabled:opacity-50"
                    >
                      {executing === "flipflop" ? "..." : "Go"}
                    </button>
                  )}
                  <button
                    onClick={() => onFlipflopStepChange(null)}
                    className="text-[10px] text-white/50 hover:text-white px-1"
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
                  className="rounded-md border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/30 transition-all backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
                >
                  Donate
                </button>
              )}
              {convertCashOpen &&
                (() => {
                  const cash = displayPersonalWealth;
                  const parsed = Number(convertCashAmount) || 0;
                  const valid = parsed > 0 && parsed <= cash;
                  const previewInfamy = valid ? calculateConvertCashInfamy(parsed) : 0;
                  const previewFunds = valid ? Math.floor(parsed * 0.5) : 0;
                  return (
                    <div className="flex items-center gap-1 animate-in slide-in-from-right-2 duration-200 flex-wrap sm:flex-nowrap">
                      <div className="relative flex-1 sm:flex-none">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white/50">
                          $
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={cash}
                          value={convertCashAmount}
                          onChange={(e) => onConvertCashAmountChange(e.target.value)}
                          placeholder="Amt"
                          className="w-full sm:w-24 rounded-md border border-white/15 bg-white/10 pl-5 pr-2 py-1.5 text-[10px] font-medium text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500/50 backdrop-blur-sm"
                        />
                      </div>
                      {valid && (
                        <span className="text-[10px] text-white/60 whitespace-nowrap">
                          +{formatAmount(previewFunds)} / +{previewInfamy}% inf
                        </span>
                      )}
                      {valid && !convertConfirming && (
                        <button
                          onClick={() => setConvertConfirming(true)}
                          disabled={!!executing}
                          className="rounded-md bg-amber-600 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-amber-500 transition-all disabled:opacity-50"
                        >
                          {executing === "convertCash" ? "..." : "Go"}
                        </button>
                      )}
                      {valid && convertConfirming && (
                        <button
                          onClick={() => {
                            setConvertConfirming(false);
                            onConvertCashExecute(parsed);
                          }}
                          disabled={!!executing}
                          title={`Self-funding raises Infamy by +${previewInfamy}%. Infamy decays 5% per turn.`}
                          className="rounded-md bg-red-600 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-red-500 transition-all disabled:opacity-50 whitespace-nowrap"
                        >
                          {executing === "convertCash" ? "..." : `+${previewInfamy}% inf, sure?`}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setConvertConfirming(false);
                          onConvertCashOpenChange(false);
                        }}
                        className="text-[10px] text-white/50 hover:text-white px-1"
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
