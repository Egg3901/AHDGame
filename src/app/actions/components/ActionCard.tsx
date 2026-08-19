"use client";

import { memo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { calculateConvertCashInfamy } from "@/lib/actions";
import { CARD_PHOTO_SCRIM, CATEGORY_ACCENTS, CATEGORY_LABELS } from "../actionsConstants";
import type { ActionCardProps } from "../actionsTypes";
import ActionExecuteRow from "./ActionExecuteRow";

const ActionCard = memo(function ActionCard({
  card,
  imageUrl,
  character,
  homeState,
  executing,
  flash,
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
  const { formatAmount, convert, toInternal, inputSymbol, forexRates } = useCurrency();
  // Self-funding confirm step: the player must acknowledge the Infamy cost
  // before the donation is submitted (server behavior unchanged).
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
  else if (isFundraise)
    effectiveFundLabel = `+${formatCurrencyFaceAmount(fundraiseYield, campaignCurrency)}`;
  else if (isConvertCash) {
    effectiveFundLabel =
      displayPersonalWealth > 0 ? `${formatAmount(displayPersonalWealth)} available` : "No cash";
  } else effectiveFundLabel = card.fundLabel(character);

  const didFlash = flash?.type === card.type;
  const noDonor = card.requiresDonorBase && (character.donorBaseLevel ?? 0) === 0;
  const noCash = isConvertCash && displayPersonalWealth <= 0;
  const fundNeeded = effectiveFundCost;
  // When forex rates are loaded, convert the ₳ cost to home currency so the
  // comparison uses the same units as displayCampaignFunds (stored home currency).
  const fundNeededConverted =
    fundNeeded !== null && forexEnabled && forexRates ? convert(fundNeeded) : fundNeeded;
  const cantAffordFunds =
    fundNeededConverted !== null && displayCampaignFunds < fundNeededConverted;
  const cantAffordActions = character.actions < effectiveActionCost;
  const isMaxed = isCampaign && campaignMaxed;
  const blocked =
    gdpCostsBlocked || isMaxed || noDonor || noCash || cantAffordFunds || cantAffordActions;
  const accent = CATEGORY_ACCENTS[card.category] ?? CATEGORY_ACCENTS.influence;

  return (
    <div
      data-coach={`action-${card.type}`}
      className={`group relative flex flex-col rounded-xl border border-card-border bg-card overflow-hidden shadow-sm transition-all duration-300 hover:shadow-lg ${accent.border} hover:-translate-y-1
        ${blocked ? "opacity-60" : ""}
      `}
    >
      {/* Image Header — period photography, resolved for the live era + country */}
      <div className="relative h-44 overflow-hidden">
        {/* unoptimized: static Cloudflare CDN art — routing through the Railway image optimizer would add egress */}
        <Image
          src={imageUrl}
          alt={card.imageAlt}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          loading="lazy"
          unoptimized={bypassNextImageOptimization(imageUrl)}
          className="object-cover transition-transform duration-700 group-hover:scale-[1.06]"
        />
        <div className={`absolute inset-0 bg-gradient-to-t ${CARD_PHOTO_SCRIM}`} />
        <div className={`absolute inset-x-0 top-0 h-0.5 ${accent.bar} opacity-70`} aria-hidden />

        <div className="absolute inset-0 p-4 flex flex-col justify-between">
          <div className="flex justify-between items-start gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md ${accent.chip}`}
            >
              {CATEGORY_LABELS[card.category]}
            </span>
          </div>
          <div>
            <h3 className="text-xl font-bold text-white drop-shadow-md leading-tight">
              {card.label}
            </h3>
            <p className="text-xs text-white/85 font-medium tracking-wide drop-shadow-sm mt-0.5">
              {card.tagline}
            </p>
          </div>
        </div>

        {/* Flash Message */}
        {didFlash && (
          <div
            className={`absolute inset-0 flex items-center justify-center bg-card/95 p-6 text-center text-sm font-semibold backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200
              ${flash.ok ? "text-green-400" : "text-red-400"}`}
          >
            {flash.msg}
          </div>
        )}
      </div>

      {/* Content Body */}
      <div className="flex flex-col flex-1 p-4 gap-4">
        <p className="text-sm text-muted leading-relaxed flex-1">{card.flavor}</p>

        {/* Stats/Costs Grid */}
        <dl className="grid grid-cols-2 divide-x divide-card-border/60 rounded-lg bg-card-elevated border border-card-border/50 overflow-hidden">
          <div className="flex flex-col gap-0.5 p-3">
            <dt className="text-[10px] text-muted uppercase tracking-wider font-semibold">Cost</dt>
            <dd className="flex items-center gap-1.5 text-xs font-medium text-foreground tabular-nums">
              <span className={cantAffordActions ? "text-error" : ""}>
                {effectiveActionCost} AP
              </span>
              <span className="text-muted/50">•</span>
              <span className={cantAffordFunds ? "text-error" : ""}>{effectiveFundLabel}</span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 p-3">
            <dt className="text-[10px] text-muted uppercase tracking-wider font-semibold">
              Effect
            </dt>
            <dd className="text-xs font-medium text-primary leading-snug">{card.effect}</dd>
            {card.effectNote && (
              <dd className="text-[10px] leading-snug text-muted">{card.effectNote}</dd>
            )}
          </div>
        </dl>

        {/* Warnings */}
        {(gdpCostsBlocked ||
          isMaxed ||
          noDonor ||
          noCash ||
          cantAffordFunds ||
          cantAffordActions) && (
          <div className="text-xs font-medium text-error flex items-start gap-1.5 px-1">
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>
              {gdpCostsBlocked &&
                "Could not load your home state for cost estimates. Refresh the page or try again shortly."}
              {!gdpCostsBlocked && isMaxed && "Influence maxed at 100%."}
              {!gdpCostsBlocked && !isMaxed && noDonor && "Requires donor network."}
              {!gdpCostsBlocked && !isMaxed && !noDonor && noCash && "No personal cash on hand."}
              {!gdpCostsBlocked &&
                !isMaxed &&
                !noDonor &&
                !noCash &&
                cantAffordFunds &&
                `Insufficient funds.`}
              {!gdpCostsBlocked &&
                !isMaxed &&
                !noDonor &&
                !noCash &&
                !cantAffordFunds &&
                cantAffordActions &&
                `Insufficient actions.`}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-auto">
          {card.href ? (
            <Link
              href={card.href}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-card-elevated border border-card-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all"
            >
              View Dashboard
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          ) : card.type === "flipflop" ? (
            <div className="space-y-3">
              {flipflopStep === null && (
                <button
                  onClick={() => onFlipflopStepChange("axis")}
                  disabled={blocked || !!executing}
                  className="w-full rounded-lg bg-card-elevated border border-card-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Flip-Flop
                </button>
              )}

              {flipflopStep === "axis" && (
                <div className="animate-in slide-in-from-bottom-2 duration-200">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {(["economic", "social"] as const).map((ax) => (
                      <button
                        key={ax}
                        onClick={() => {
                          onFlipflopAxisChange(ax);
                          onFlipflopStepChange("direction");
                        }}
                        className="rounded-md bg-card-elevated border border-card-border py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-primary/10 hover:border-primary/30 transition-all"
                      >
                        {ax}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => onFlipflopStepChange(null)}
                    className="w-full text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {flipflopStep === "direction" && flipflopAxis && (
                <div className="animate-in slide-in-from-bottom-2 duration-200 space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                      {flipflopAxis}
                    </span>
                    <span className="text-xs font-bold tabular-nums">
                      {flipflopAxis === "economic"
                        ? character.policies?.economic
                        : character.policies?.social}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => onFlipflopDirChange(-1)}
                      className={`rounded-md border py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
                        flipflopDir === -1
                          ? "bg-red-500/20 border-red-500 text-red-400"
                          : "bg-card-elevated border-card-border hover:bg-card-elevated/80"
                      }`}
                    >
                      Left
                    </button>
                    <button
                      onClick={() => onFlipflopDirChange(1)}
                      className={`rounded-md border py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
                        flipflopDir === 1
                          ? "bg-red-500/20 border-red-500 text-red-400"
                          : "bg-card-elevated border-card-border hover:bg-card-elevated/80"
                      }`}
                    >
                      Right
                    </button>
                  </div>

                  {flipflopDir !== null && (
                    <button
                      onClick={() => onFlipflop(flipflopAxis, flipflopDir)}
                      disabled={!!executing}
                      className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-red-500 hover:shadow-red-500/20 transition-all disabled:opacity-50"
                    >
                      {executing === "flipflop" ? "Shifting..." : "Confirm Shift"}
                    </button>
                  )}

                  <button
                    onClick={() => onFlipflopStepChange(null)}
                    className="w-full text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ) : isConvertCash ? (
            <div className="space-y-3">
              {!convertCashOpen && (
                <button
                  onClick={() => onConvertCashOpenChange(true)}
                  disabled={blocked || !!executing}
                  className="w-full rounded-lg bg-card-elevated border border-card-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Donation
                </button>
              )}

              {convertCashOpen &&
                (() => {
                  // Display cash in the player's chosen currency; inputs work in that unit.
                  const displayCash = Math.floor(convert(displayPersonalWealth));
                  const parsed = Number(convertCashAmount) || 0;
                  const valid = parsed > 0 && parsed <= displayCash;
                  // Post-Phase-6: the route reads/writes convertCash in the
                  // player's LOCAL home currency, so the preview math stays in
                  // local. Infamy still scales off the anchor magnitude.
                  const previewFunds = valid ? Math.floor(parsed * 0.5) : 0;
                  const previewInfamy = valid
                    ? calculateConvertCashInfamy(Math.round(toInternal(parsed)))
                    : 0;
                  return (
                    <div className="animate-in slide-in-from-bottom-2 duration-200 space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                          Cash on Hand
                        </span>
                        <span className="text-xs font-bold tabular-nums">
                          {inputSymbol}
                          {displayCash.toLocaleString("en-US")}
                        </span>
                      </div>

                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                          {inputSymbol}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={displayCash}
                          value={convertCashAmount}
                          onChange={(e) => onConvertCashAmountChange(e.target.value)}
                          placeholder="Amount to convert"
                          className="w-full rounded-md border border-card-border bg-card-elevated pl-7 pr-3 py-1.5 text-xs font-medium text-foreground placeholder:text-muted/60 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-1">
                        {[0.25, 0.5, 1].map((pct) => (
                          <button
                            key={pct}
                            onClick={() =>
                              onConvertCashAmountChange(String(Math.floor(displayCash * pct)))
                            }
                            className="rounded-md bg-card-elevated border border-card-border py-1 text-[10px] font-bold uppercase tracking-wider hover:bg-amber-500/10 hover:border-amber-500/30 transition-all"
                          >
                            {pct === 1 ? "Max" : `${pct * 100}%`}
                          </button>
                        ))}
                      </div>

                      {valid && (
                        <div className="grid grid-cols-2 gap-2 px-1 text-[10px]">
                          <div>
                            <span className="text-muted uppercase tracking-wider font-semibold">
                              Campaign Funds
                            </span>
                            <p className="text-xs font-bold text-green-400">
                              +{inputSymbol}
                              {previewFunds.toLocaleString("en-US")}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted uppercase tracking-wider font-semibold">
                              Infamy
                            </span>
                            <p className="text-xs font-bold text-red-400">+{previewInfamy}%</p>
                          </div>
                        </div>
                      )}

                      {valid && !convertConfirming && (
                        <button
                          onClick={() => setConvertConfirming(true)}
                          disabled={!!executing}
                          className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-amber-500 hover:shadow-amber-500/20 transition-all disabled:opacity-50"
                        >
                          {executing === "convertCash" ? "Converting..." : "Confirm Donation"}
                        </button>
                      )}

                      {valid && convertConfirming && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
                          <p className="text-xs leading-snug text-foreground">
                            Self-funding your campaign raises Infamy by +{previewInfamy}%. Infamy
                            decays 5% per turn.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setConvertConfirming(false);
                                onConvertCashExecute(Math.round(parsed));
                              }}
                              disabled={!!executing}
                              className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 transition-all disabled:opacity-50"
                            >
                              {executing === "convertCash" ? "Converting..." : "Yes, donate"}
                            </button>
                            <button
                              onClick={() => setConvertConfirming(false)}
                              className="flex-1 rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
                            >
                              Back
                            </button>
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => {
                          setConvertConfirming(false);
                          onConvertCashOpenChange(false);
                        }}
                        className="w-full text-xs text-muted hover:text-foreground transition-colors"
                      >
                        Cancel
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
              forexEnabled={forexEnabled}
            />
          )}
        </div>
      </div>
    </div>
  );
});

export default ActionCard;
