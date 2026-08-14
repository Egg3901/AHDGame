import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Character, State } from "@/lib/db/types";
import { SectionHeader } from "./ProfileMeters";
import { InfoTooltip } from "@/components/InfoTooltip";
import { ACTION_HOARDING_PENALTY } from "@/lib/actions/recommendationsConstants";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { STAT_MIN } from "@/lib/stats/statsConstants";

const INFO_ICON = (
  <svg
    className="inline-block h-3 w-3 ml-1 text-muted/50 pointer-events-none"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

interface PoliticalStandingProps {
  character: Character;
  homeState: State | null;
  influence: number;
  nationalInfluence: number;
  influenceDecay: string;
  nationalGainPerTurn: string;
  favorability: number;
  favColor: string;
  favDecayDisplay: string | null;
  infamy: number;
  infamyPenalty: string | null;
  maxNPI: number;
  baseActionsPerTurn?: number;
  officeActionBonus?: number;
  chairActionBonus?: number;
  /** Labeled per-source breakdown lines (Base / Office / Cabinet / Chair / Party). */
  actionBreakdown?: { label: string; amount: number }[];
  totalActionsPerTurn: number;
  actionHoarding: boolean;
  /** Party influence bonus actions this turn (0-max) */
  bonusActionsFromParty?: number;
  /** Party influence max bonus cap from config */
  partyInfluenceMaxBonus?: number;
  /** Net party influence gain/loss per turn */
  partyInfluenceNetGain?: number;
  /** Character's share of total party influence (0-100%) */
  partyInfluenceShare?: number;
  /** Whether this is the viewer's own profile — controls Campaign Office link visibility */
  isOwnProfile?: boolean;
  /** 1–3 when this character is that high on the national NPI leaderboard for their country */
  nationalNpiLeaderRank?: 1 | 2 | 3;
}

/** Compute the heat-gradient color (green → yellow → red) for 0-100% */
function heatColor(pct: number): string {
  const t = Math.min(1, Math.max(0, pct / 100));
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(34 + s * 221);
    g = Math.round(197);
    b = Math.round(94 - s * 94);
  } else {
    const s = (t - 0.5) * 2;
    r = 255;
    g = Math.round(197 - s * 197);
    b = 0;
  }
  return `rgb(${r},${g},${b})`;
}

/** Inline progress bar used in each stat row */
function InlineBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-[6px] w-full bg-card-elevated rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}

/** Inline gradient bar (green → yellow → red) */
function InlineHeatBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-[6px] w-full bg-card-elevated rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${clamped}%`,
          background:
            clamped > 0 ? `linear-gradient(90deg, #22c55e, ${heatColor(clamped)})` : "#22c55e",
        }}
      />
    </div>
  );
}

export function PoliticalStanding({
  character,
  homeState,
  influence,
  nationalInfluence,
  influenceDecay,
  nationalGainPerTurn,
  favorability,
  favColor,
  favDecayDisplay,
  infamy,
  infamyPenalty,
  maxNPI,
  baseActionsPerTurn,
  officeActionBonus,
  chairActionBonus,
  actionBreakdown,
  totalActionsPerTurn,
  actionHoarding,
  bonusActionsFromParty,
  partyInfluenceMaxBonus,
  partyInfluenceNetGain,
  partyInfluenceShare,
  isOwnProfile = true,
  nationalNpiLeaderRank,
}: PoliticalStandingProps) {
  const t = useTranslations("profile.standing");
  // Action cap and hoard threshold scale with the character's Energy stat
  // (engine: actionRefresh.ts → energyActionLimits). Unmigrated characters with
  // no Energy stat fall back to the baseline via STAT_MIN, matching the engine.
  const { cap: actionCap, threshold: hoardThreshold } = energyActionLimits(
    character.stats?.energy ?? STAT_MIN
  );
  const actionPct = Math.min(100, (character.actions / actionCap) * 100);
  const actionColor = heatColor(actionPct);
  const actionsPerTurn = totalActionsPerTurn + (bonusActionsFromParty ?? 0);
  const showParty = character.party && character.party !== "independent";

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-card overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-0">
        <SectionHeader>{t("title")}</SectionHeader>
      </div>

      {/* Stat rows */}
      <div>
        {/* Actions */}
        <div className="grid grid-cols-[130px_1fr_90px] items-center gap-4 px-6 py-3.5 border-b border-card-border/20 transition-colors duration-150 hover:bg-card-elevated/40 active:bg-card-elevated/60">
          <div>
            <InfoTooltip
              trigger={
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {t("actions")}
                  {INFO_ICON}
                </span>
              }
            >
              <div className="text-muted space-y-1">
                <p>
                  {baseActionsPerTurn != null && officeActionBonus != null ? (
                    <>
                      {t("actionsBase", { count: baseActionsPerTurn })}
                      {officeActionBonus > 0 && (
                        <> + {t("actionsOffice", { count: officeActionBonus })}</>
                      )}
                      {(chairActionBonus ?? 0) > 0 && (
                        <> + {t("actionsChair", { count: chairActionBonus ?? 0 })}</>
                      )}
                      {(bonusActionsFromParty ?? 0) > 0 && (
                        <> + {t("actionsParty", { count: bonusActionsFromParty ?? 0 })}</>
                      )}{" "}
                      = <strong>{actionsPerTurn}</strong> {t("actionsPerTurnUnit")}
                    </>
                  ) : (
                    <>{t("actionsSimple", { count: totalActionsPerTurn })}</>
                  )}
                </p>
                {actionBreakdown && actionBreakdown.length > 0 && (
                  <div className="border-t border-card-border/30 pt-1 space-y-0.5">
                    {actionBreakdown.map((item) => (
                      <div key={item.label} className="flex justify-between gap-3 tabular-nums">
                        <span>{item.label}</span>
                        <span>+{item.amount}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p>{t("turnExplainer", { cap: actionCap })}</p>
                <p>
                  {t("hoardWarning", {
                    threshold: hoardThreshold,
                    penalty: ACTION_HOARDING_PENALTY,
                  })}
                </p>
              </div>
            </InfoTooltip>
            <div className="text-[10px] text-muted/70 font-medium mt-0.5">
              {t("perTurn", { count: actionsPerTurn })}
              {actionHoarding && (
                <span className="text-error ml-1">
                  {t("hoardTag", { penalty: ACTION_HOARDING_PENALTY })}
                </span>
              )}
            </div>
          </div>
          <InlineHeatBar pct={actionPct} />
          <div className="text-right">
            <span className="text-sm font-bold tabular-nums" style={{ color: actionColor }}>
              {character.actions}
            </span>
            <span className="text-xs text-muted font-normal ml-0.5">/ {actionCap}</span>
            {isOwnProfile && (
              <div className="text-[10px] text-muted/70 font-medium mt-0.5">
                <Link
                  href="/actions"
                  className="text-primary/80 hover:text-primary hover:underline"
                >
                  {t("campaignOffice")}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Influence (State) */}
        <div className="grid grid-cols-[130px_1fr_90px] items-center gap-4 px-6 py-3.5 border-b border-card-border/20 transition-colors duration-150 hover:bg-card-elevated/40 active:bg-card-elevated/60">
          <div>
            <InfoTooltip
              trigger={
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {t("influence")}
                  {INFO_ICON}
                </span>
              }
            >
              <p className="text-muted">{t("influenceTooltip")}</p>
            </InfoTooltip>
            <div className="text-[10px] text-muted/70 font-medium mt-0.5">{homeState?.name}</div>
          </div>
          <InlineBar pct={influence} color="var(--primary)" />
          <div className="text-right">
            <span className="text-sm font-bold tabular-nums text-primary">
              {influence.toFixed(1)}%
            </span>
            <div className="text-[10px] text-error/80 font-medium mt-0.5">
              {t("decay", { value: influenceDecay })}
            </div>
          </div>
        </div>

        {/* National Influence */}
        <div className="grid grid-cols-[130px_1fr_90px] items-center gap-4 px-6 py-3.5 border-b border-card-border/20 transition-colors duration-150 hover:bg-card-elevated/40 active:bg-card-elevated/60">
          <div>
            <InfoTooltip
              trigger={
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {t("national")}
                  {INFO_ICON}
                </span>
              }
            >
              <p className="text-muted">{t("nationalTooltip")}</p>
            </InfoTooltip>
            <div className="text-[10px] text-muted/70 font-medium mt-0.5">
              {t("nationalTop", { value: maxNPI.toFixed(1) })}
            </div>
          </div>
          <div
            className={`min-w-0 rounded-full p-[3px] transition-shadow duration-300 ${
              nationalNpiLeaderRank === 1
                ? "shadow-[0_0_16px_rgba(234,179,8,0.55)]"
                : nationalNpiLeaderRank === 2
                  ? "shadow-[0_0_14px_rgba(148,163,184,0.55)]"
                  : nationalNpiLeaderRank === 3
                    ? "shadow-[0_0_14px_rgba(217,119,6,0.48)]"
                    : ""
            }`}
          >
            <InlineBar
              pct={maxNPI > 0 ? (nationalInfluence / maxNPI) * 100 : 0}
              color="var(--info)"
            />
          </div>
          <div className="text-right">
            <span className="text-sm font-bold tabular-nums text-info">
              {nationalInfluence.toFixed(1)}
            </span>
            <div className="text-[10px] text-success/80 font-medium mt-0.5">
              {t("gain", { value: nationalGainPerTurn })}
            </div>
          </div>
        </div>

        {/* Favorability */}
        <div className="grid grid-cols-[130px_1fr_90px] items-center gap-4 px-6 py-3.5 border-b border-card-border/20 transition-colors duration-150 hover:bg-card-elevated/40 active:bg-card-elevated/60">
          <div>
            <InfoTooltip
              trigger={
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {t("favorability")}
                  {INFO_ICON}
                </span>
              }
            >
              <p className="text-muted">{t("favorabilityTooltip")}</p>
            </InfoTooltip>
            <div className="text-[10px] text-muted/70 font-medium mt-0.5">
              {t("publicApproval")}
            </div>
          </div>
          <InlineBar pct={favorability} color={favColor} />
          <div className="text-right">
            <span className="text-sm font-bold tabular-nums" style={{ color: favColor }}>
              {favorability.toFixed(1)}%
            </span>
            {favDecayDisplay && (
              <div className="text-[10px] text-error/80 font-medium mt-0.5">
                {t("decay", { value: favDecayDisplay })}
              </div>
            )}
          </div>
        </div>

        {/* Infamy */}
        <div className="grid grid-cols-[130px_1fr_90px] items-center gap-4 px-6 py-3.5 border-b border-card-border/20 transition-colors duration-150 hover:bg-card-elevated/40 active:bg-card-elevated/60">
          <div>
            <InfoTooltip
              trigger={
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {t("infamy")}
                  {INFO_ICON}
                </span>
              }
            >
              <p className="text-muted">{t("infamyTooltip")}</p>
            </InfoTooltip>
            <div className="text-[10px] text-muted/70 font-medium mt-0.5">
              {t("publicNotoriety")}
            </div>
          </div>
          <InlineHeatBar pct={infamy} />
          <div className="text-right">
            <span
              className={`text-sm font-bold tabular-nums ${infamy > 20 ? "text-error" : "text-muted"}`}
            >
              {infamy.toFixed(1)}%
            </span>
            <div className="text-[10px] font-medium mt-0.5">
              {infamyPenalty ? (
                <span className="text-error/80">
                  {t("infamyFavPenalty", { value: infamyPenalty })}
                </span>
              ) : (
                <span className="text-success/80">{t("safe")}</span>
              )}
            </div>
          </div>
        </div>

        {/* Party Influence */}
        {showParty && (
          <div className="grid grid-cols-[130px_1fr_90px] items-center gap-4 px-6 py-3.5 border-b border-card-border/20 transition-colors duration-150 hover:bg-card-elevated/40 active:bg-card-elevated/60">
            <div>
              <InfoTooltip
                trigger={
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    {t("partyInfluence")}
                    {INFO_ICON}
                  </span>
                }
              >
                <div className="text-muted space-y-1">
                  <p>{t("partyInfluenceTooltip")}</p>
                  {bonusActionsFromParty != null && (
                    <p>
                      {t("partyBonusEarning", {
                        count: bonusActionsFromParty,
                        max: partyInfluenceMaxBonus ?? 6,
                      })}
                    </p>
                  )}
                  {partyInfluenceShare != null && (
                    <p>{t("partyShare", { share: partyInfluenceShare })}</p>
                  )}
                </div>
              </InfoTooltip>
              <div className="text-[10px] text-muted/70 font-medium mt-0.5">
                {partyInfluenceNetGain != null
                  ? t("netPerTurn", {
                      value: `${partyInfluenceNetGain >= 0 ? "+" : ""}${partyInfluenceNetGain.toFixed(1)}`,
                    })
                  : t("withinPartyStanding")}
              </div>
            </div>
            <InlineBar pct={character.partyInfluence ?? 0} color="var(--primary)" />
            <div className="text-right">
              <span className="text-sm font-bold tabular-nums text-primary">
                {(character.partyInfluence ?? 0).toFixed(1)}
              </span>
              <div className="text-[10px] text-muted/70 font-medium mt-0.5">
                {bonusActionsFromParty != null
                  ? t("bonusActCount", { count: bonusActionsFromParty })
                  : t("bonusActions")}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
