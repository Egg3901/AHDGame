"use client";

import { memo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { campaignAnchorToLocal } from "@/lib/campaigns/rules/currency";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import {
  calculateConvertCashInfamy,
  convertCashConversion,
  isFundraiseEligible,
} from "@/lib/actions";
import {
  CARD_PHOTO_SCRIM,
  CATEGORY_LABELS,
  FUND_LINE_TERMS,
  fundLineKind,
} from "../actionsConstants";

const FLIPFLOP_AXIS_LABELS = { economic: "Economic", social: "Social" } as const;
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
  projection,
}: ActionCardProps) {
  const {
    formatAmount,
    toDisplay,
    toInternal,
    toInternalFrom,
    toLocalOf,
    currencyCode,
    inputSymbol,
    baseRates,
  } = useCurrency();
  const personalAnchor = forexEnabled
    ? toInternalFrom(displayPersonalWealth, currencyCode)
    : displayPersonalWealth;
  const politicalLocal = (amount: number) =>
    forexEnabled ? campaignAnchorToLocal(amount, character.countryId ?? "US", baseRates) : amount;
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
      displayPersonalWealth > 0 ? `${formatAmount(personalAnchor)} to convert` : "No cash";
  } else effectiveFundLabel = card.fundLabel(character);
  const fundKind = fundLineKind(card.type);

  const didFlash = flash?.type === card.type;
  const noDonor = card.requiresDonorBase && !isFundraiseEligible(character.donorBaseLevel);
  const noCash = isConvertCash && displayPersonalWealth <= 0;
  const fundNeeded = effectiveFundCost;
  // When forex rates are loaded, convert the ₳ cost to home currency so the
  // comparison uses the same units as displayCampaignFunds (stored home currency).
  const fundNeededConverted = fundNeeded !== null ? politicalLocal(fundNeeded) : fundNeeded;
  const cantAffordFunds =
    fundNeededConverted !== null && displayCampaignFunds < fundNeededConverted;
  const cantAffordActions = character.actions < effectiveActionCost;
  const isMaxed = isCampaign && campaignMaxed;
  const blocked =
    gdpCostsBlocked || isMaxed || noDonor || noCash || cantAffordFunds || cantAffordActions;

  return (
    <div
      data-coach={`action-${card.type}`}
      className="relative flex flex-col overflow-hidden rounded-xl border border-card-border bg-card transition-colors hover:border-foreground/20"
    >
      {/* Image Header — period photography, resolved for the live era + country */}
      <div className="relative h-36 overflow-hidden">
        {/* unoptimized: static Cloudflare CDN art — routing through the Railway image optimizer would add egress */}
        <Image
          src={imageUrl}
          alt={card.imageAlt}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          loading="lazy"
          unoptimized={bypassNextImageOptimization(imageUrl)}
          className={`object-cover transition-[filter] ${blocked ? "grayscale" : ""}`}
        />
        <div className={`absolute inset-0 bg-gradient-to-t ${CARD_PHOTO_SCRIM}`} />

        <div className="absolute inset-0 flex flex-col justify-end p-4">
          <h3 className="text-heading font-semibold leading-tight text-white">{card.label}</h3>
          <p className="mt-0.5 text-body-sm text-white/85">
            {CATEGORY_LABELS[card.category]} · {card.tagline}
          </p>
        </div>
      </div>

      {/* Content Body */}
      <div className="flex flex-col flex-1 p-4 gap-4">
        <p className="flex-1 text-body leading-relaxed text-muted">{card.flavor}</p>

        {/* Cost and effect: two plain rows */}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-card-border pt-3 text-body">
          <dt className="text-muted">{FUND_LINE_TERMS.cost}</dt>
          <dd className="font-medium tabular-nums text-foreground">
            <span className={cantAffordActions ? "text-error" : ""}>{effectiveActionCost} AP</span>
            {fundKind === "cost" && (
              <>
                <span className="mx-1.5 text-muted" aria-hidden>
                  ·
                </span>
                <span className={cantAffordFunds ? "text-error" : ""}>{effectiveFundLabel}</span>
              </>
            )}
          </dd>
          {fundKind !== "cost" && (
            <>
              <dt className="text-muted">{FUND_LINE_TERMS[fundKind]}</dt>
              <dd
                className={`font-medium tabular-nums ${
                  fundKind === "yield" ? "text-success" : noCash ? "text-error" : "text-foreground"
                }`}
              >
                {effectiveFundLabel}
              </dd>
            </>
          )}
          <dt className="text-muted">Effect</dt>
          <dd className="text-foreground">
            {card.effect}
            {card.effectNote && (
              <span className="mt-0.5 block text-body-sm text-muted">{card.effectNote}</span>
            )}
          </dd>
          {projection && (
            <>
              <dt className="text-muted">After</dt>
              <dd className="tabular-nums text-foreground">
                <span className="text-muted">{projection.label} </span>
                {projection.from}
                <span className="mx-1.5 text-muted" aria-label="becomes">
                  →
                </span>
                <span className="font-semibold text-success">{projection.to}</span>
              </dd>
            </>
          )}
        </dl>

        {/* Warnings */}
        {(gdpCostsBlocked ||
          isMaxed ||
          noDonor ||
          noCash ||
          cantAffordFunds ||
          cantAffordActions) && (
          <div className="flex items-start gap-1.5 text-body-sm font-medium text-error">
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
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card-muted"
            >
              View dashboard
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
                  className="w-full rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Start flip-flop
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
                        className="rounded-md border border-card-border bg-card-elevated py-1.5 text-body-sm font-semibold transition-colors hover:bg-card-muted"
                      >
                        {FLIPFLOP_AXIS_LABELS[ax]}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => onFlipflopStepChange(null)}
                    className="w-full text-body-sm text-muted transition-colors hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {flipflopStep === "direction" && flipflopAxis && (
                <div className="animate-in slide-in-from-bottom-2 duration-200 space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-body-sm text-muted">
                      {FLIPFLOP_AXIS_LABELS[flipflopAxis]}
                    </span>
                    <span className="text-body-sm font-semibold tabular-nums">
                      {flipflopAxis === "economic"
                        ? character.policies?.economic
                        : character.policies?.social}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => onFlipflopDirChange(-1)}
                      aria-pressed={flipflopDir === -1}
                      className={`rounded-md border py-1.5 text-body-sm font-semibold transition-colors ${
                        flipflopDir === -1
                          ? "border-foreground/50 bg-card-muted text-foreground"
                          : "border-card-border bg-card-elevated hover:bg-card-muted"
                      }`}
                    >
                      Left
                    </button>
                    <button
                      onClick={() => onFlipflopDirChange(1)}
                      aria-pressed={flipflopDir === 1}
                      className={`rounded-md border py-1.5 text-body-sm font-semibold transition-colors ${
                        flipflopDir === 1
                          ? "border-foreground/50 bg-card-muted text-foreground"
                          : "border-card-border bg-card-elevated hover:bg-card-muted"
                      }`}
                    >
                      Right
                    </button>
                  </div>

                  {flipflopDir !== null && (
                    <button
                      onClick={() => onFlipflop(flipflopAxis, flipflopDir)}
                      disabled={!!executing}
                      className="w-full rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-error-muted disabled:opacity-50"
                    >
                      {executing === "flipflop" ? "Shifting..." : "Confirm shift"}
                    </button>
                  )}

                  <button
                    onClick={() => onFlipflopStepChange(null)}
                    className="w-full text-body-sm text-muted transition-colors hover:text-foreground"
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
                  className="w-full rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Start donation
                </button>
              )}

              {convertCashOpen &&
                (() => {
                  // Display cash in the player's chosen currency; inputs work in that unit.
                  const displayCash = Math.floor(toDisplay(personalAnchor));
                  const parsed = Number(convertCashAmount) || 0;
                  // The route debits local ledger units, while the input follows
                  // the player's chosen display currency.
                  const localDonation = Math.round(toLocalOf(parsed, currencyCode));
                  const valid =
                    parsed > 0 &&
                    parsed <= displayCash &&
                    localDonation > 0 &&
                    localDonation <= displayPersonalWealth;
                  const previewFunds = valid
                    ? toDisplay(toInternalFrom(convertCashConversion(localDonation), currencyCode))
                    : 0;
                  const previewInfamy = valid
                    ? calculateConvertCashInfamy(Math.round(toInternal(parsed)))
                    : 0;
                  return (
                    <div className="animate-in slide-in-from-bottom-2 duration-200 space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-body-sm text-muted">Cash you can convert</span>
                        <span className="text-body-sm font-semibold tabular-nums">
                          {inputSymbol}
                          {displayCash.toLocaleString("en-US")}
                        </span>
                      </div>

                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-body-sm text-muted">
                          {inputSymbol}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={displayCash}
                          value={convertCashAmount}
                          onChange={(e) => onConvertCashAmountChange(e.target.value)}
                          placeholder="Amount to convert"
                          className="w-full rounded-md border border-card-border bg-card-elevated py-1.5 pl-7 pr-3 text-body-sm font-medium text-foreground placeholder:text-muted/60 focus:border-foreground/40 focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-1">
                        {[0.25, 0.5, 1].map((pct) => (
                          <button
                            key={pct}
                            onClick={() =>
                              onConvertCashAmountChange(String(Math.floor(displayCash * pct)))
                            }
                            className="rounded-md border border-card-border bg-card-elevated py-1 text-body-sm font-semibold transition-colors hover:bg-card-muted"
                          >
                            {pct === 1 ? "Max" : `${pct * 100}%`}
                          </button>
                        ))}
                      </div>

                      {valid && (
                        <dl className="grid grid-cols-2 gap-2 px-1 text-body-sm">
                          <div>
                            <dt className="text-muted">Campaign funds</dt>
                            <dd className="font-semibold tabular-nums text-success">
                              +{inputSymbol}
                              {previewFunds.toLocaleString("en-US")}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted">Infamy</dt>
                            <dd className="font-semibold tabular-nums text-error">
                              +{previewInfamy}%
                            </dd>
                          </div>
                        </dl>
                      )}

                      {valid && !convertConfirming && (
                        <button
                          onClick={() => setConvertConfirming(true)}
                          disabled={!!executing}
                          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
                        >
                          {executing === "convertCash" ? "Converting..." : "Confirm donation"}
                        </button>
                      )}

                      {valid && convertConfirming && (
                        <div className="space-y-2 rounded-lg border border-error/30 p-3">
                          <p className="text-body-sm leading-snug text-foreground">
                            Self-funding your campaign raises Infamy by +{previewInfamy}%. Infamy
                            decays 5% per turn.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setConvertConfirming(false);
                                onConvertCashExecute(localDonation);
                              }}
                              disabled={!!executing}
                              className="flex-1 rounded-lg bg-error px-3 py-1.5 text-body-sm font-semibold text-white transition-colors hover:bg-error-muted disabled:opacity-50"
                            >
                              {executing === "convertCash" ? "Converting..." : "Yes, donate"}
                            </button>
                            <button
                              onClick={() => setConvertConfirming(false)}
                              className="flex-1 rounded-lg border border-card-border px-3 py-1.5 text-body-sm font-medium text-muted transition-colors hover:text-foreground"
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
                        className="w-full text-body-sm text-muted transition-colors hover:text-foreground"
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

        {/* Result of the last use, kept until the next action */}
        {didFlash && (
          <p
            role="status"
            className={`flex items-start gap-1.5 text-body-sm font-medium animate-in fade-in duration-200 ${
              flash.ok ? "text-success" : "text-error"
            }`}
          >
            <svg
              className="mt-px h-4 w-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              {flash.ok ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
              )}
            </svg>
            <span>{flash.msg}</span>
          </p>
        )}
      </div>
    </div>
  );
});

export default ActionCard;
