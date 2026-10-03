import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Character, State } from "@/lib/db/types";
import { SectionHeader } from "./ProfileMeters";
import { PROFILE_LINK_CLASS } from "./profileStyles";
import { InfoTooltip } from "@/components/InfoTooltip";
import { ACTION_HOARDING_PENALTY } from "@/lib/actions/recommendationsConstants";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { STAT_MIN } from "@/lib/stats/statsConstants";

interface PoliticalStandingProps {
  character: Character;
  homeState: State | null;
  influence: number;
  nationalInfluence: number;
  influenceDecay: string;
  nationalGainPerTurn: string;
  favorability: number;
  favDecayDisplay: string | null;
  infamy: number;
  infamyPenalty: string | null;
  maxNPI: number;
  /** Ordinal rank on the country's national influence board; 0 or absent when unknown. */
  nationalRank?: number;
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
  /** Whether this is the viewer's own profile; controls Campaign Office link visibility */
  isOwnProfile?: boolean;
}

type Tone = "neutral" | "gain" | "loss";

interface StandingRow {
  key: string;
  label: string;
  tooltip: ReactNode;
  value: string;
  perTurn: string | null;
  perTurnTone: Tone;
  note: ReactNode;
  noteTone: Tone;
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-muted",
  gain: "text-success",
  loss: "text-error",
};

const MINUS = "−";

/** Signed per-turn change, coloured by direction; zero reads as neutral. */
function signedChange(value: number, digits: number): { text: string; tone: Tone } {
  const magnitude = Math.abs(value).toFixed(digits);
  if (Number(magnitude) === 0) return { text: magnitude, tone: "neutral" };
  return value > 0
    ? { text: `+${magnitude}`, tone: "gain" }
    : { text: `${MINUS}${magnitude}`, tone: "loss" };
}

/** Per-source action breakdown shown in the Actions tooltip. */
function ActionsTooltipBody({
  baseActionsPerTurn,
  officeActionBonus,
  chairActionBonus,
  bonusActionsFromParty,
  actionsPerTurn,
  totalActionsPerTurn,
  actionBreakdown,
  actionCap,
  hoardThreshold,
}: {
  baseActionsPerTurn?: number;
  officeActionBonus?: number;
  chairActionBonus?: number;
  bonusActionsFromParty?: number;
  actionsPerTurn: number;
  totalActionsPerTurn: number;
  actionBreakdown?: { label: string; amount: number }[];
  actionCap: number;
  hoardThreshold: number;
}) {
  const t = useTranslations("profile.standing");
  return (
    <>
      <p>
        {baseActionsPerTurn != null && officeActionBonus != null ? (
          <>
            {t("actionsBase", { count: baseActionsPerTurn })}
            {officeActionBonus > 0 && <> + {t("actionsOffice", { count: officeActionBonus })}</>}
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
        <div className="space-y-0.5 border-t border-card-border/30 pt-1">
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
    </>
  );
}

/**
 * Political standing as a table: one row per measure with its value, its
 * change per turn and what it means. Colour appears only on gains, losses
 * and penalties; everything else is neutral.
 */
export function PoliticalStanding({
  character,
  homeState,
  influence,
  nationalInfluence,
  influenceDecay,
  nationalGainPerTurn,
  favorability,
  favDecayDisplay,
  infamy,
  infamyPenalty,
  maxNPI,
  nationalRank = 0,
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
}: PoliticalStandingProps) {
  const t = useTranslations("profile.standing");
  // Action cap and hoard threshold scale with the character's Energy stat
  // (engine: actionRefresh.ts -> energyActionLimits). Unmigrated characters with
  // no Energy stat fall back to the baseline via STAT_MIN, matching the engine.
  const { cap: actionCap, threshold: hoardThreshold } = energyActionLimits(
    character.stats?.energy ?? STAT_MIN
  );
  const actionsPerTurn = totalActionsPerTurn + (bonusActionsFromParty ?? 0);
  const showParty = character.party && character.party !== "independent";

  const actionsChange = signedChange(actionsPerTurn, 0);
  const influenceChange = signedChange(-Number(influenceDecay), 2);
  const nationalChange = signedChange(Number(nationalGainPerTurn), 2);
  const favorabilityChange = favDecayDisplay ? signedChange(-Number(favDecayDisplay), 1) : null;
  const partyChange = partyInfluenceNetGain != null ? signedChange(partyInfluenceNetGain, 1) : null;
  const nationalTop = maxNPI.toFixed(1);

  const rows: StandingRow[] = [
    {
      key: "actions",
      label: t("actions"),
      tooltip: (
        <ActionsTooltipBody
          baseActionsPerTurn={baseActionsPerTurn}
          officeActionBonus={officeActionBonus}
          chairActionBonus={chairActionBonus}
          bonusActionsFromParty={bonusActionsFromParty}
          actionsPerTurn={actionsPerTurn}
          totalActionsPerTurn={totalActionsPerTurn}
          actionBreakdown={actionBreakdown}
          actionCap={actionCap}
          hoardThreshold={hoardThreshold}
        />
      ),
      value: `${character.actions} / ${actionCap}`,
      perTurn: actionsChange.text,
      perTurnTone: actionsChange.tone,
      note: actionHoarding
        ? t("hoarding", { penalty: ACTION_HOARDING_PENALTY })
        : t("hoardAbove", { threshold: hoardThreshold }),
      noteTone: actionHoarding ? "loss" : "neutral",
    },
    {
      key: "influence",
      label: t("stateInfluence"),
      tooltip: <p>{t("influenceTooltip")}</p>,
      value: `${influence.toFixed(1)}%`,
      perTurn: influenceChange.text,
      perTurnTone: influenceChange.tone,
      note: homeState?.name ?? null,
      noteTone: "neutral",
    },
    {
      key: "national",
      label: t("nationalInfluence"),
      tooltip: <p>{t("nationalTooltip")}</p>,
      value: nationalInfluence.toFixed(1),
      perTurn: nationalChange.text,
      perTurnTone: nationalChange.tone,
      note:
        nationalRank > 0
          ? t("nationalRankTop", { rank: nationalRank, top: nationalTop })
          : t("nationalTop", { top: nationalTop }),
      noteTone: "neutral",
    },
    {
      key: "favorability",
      label: t("favorability"),
      tooltip: <p>{t("favorabilityTooltip")}</p>,
      value: `${favorability.toFixed(1)}%`,
      perTurn: favorabilityChange?.text ?? null,
      perTurnTone: favorabilityChange?.tone ?? "neutral",
      note: favDecayDisplay ? t("favorabilityCooling") : t("favorabilityStable"),
      noteTone: "neutral",
    },
    {
      key: "infamy",
      label: t("infamy"),
      tooltip: <p>{t("infamyTooltip")}</p>,
      value: `${infamy.toFixed(1)}%`,
      perTurn: null,
      perTurnTone: "neutral",
      note: infamyPenalty ? t("infamyCost", { value: infamyPenalty }) : t("infamySafe"),
      noteTone: infamyPenalty ? "loss" : "neutral",
    },
  ];

  if (showParty) {
    rows.push({
      key: "party",
      label: t("partyInfluence"),
      tooltip: (
        <>
          <p>{t("partyInfluenceTooltip")}</p>
          {bonusActionsFromParty != null && (
            <p>
              {t("partyBonusEarning", {
                count: bonusActionsFromParty,
                max: partyInfluenceMaxBonus ?? 6,
              })}
            </p>
          )}
          {partyInfluenceShare != null && <p>{t("partyShare", { share: partyInfluenceShare })}</p>}
        </>
      ),
      value: (character.partyInfluence ?? 0).toFixed(1),
      perTurn: partyChange?.text ?? null,
      perTurnTone: partyChange?.tone ?? "neutral",
      note:
        bonusActionsFromParty != null
          ? t("partyBonus", { count: bonusActionsFromParty, max: partyInfluenceMaxBonus ?? 6 })
          : t("withinPartyStanding"),
      noteTone: "neutral",
    });
  }

  return (
    <section>
      <SectionHeader
        action={
          isOwnProfile ? (
            <Link href="/actions" className={`text-body-sm ${PROFILE_LINK_CLASS}`}>
              {t("campaignOffice")}
            </Link>
          ) : undefined
        }
      >
        {t("title")}
      </SectionHeader>
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-card-border text-body-sm text-muted">
            <th scope="col" className="py-2 pr-3 text-left font-medium">
              {t("colMeasure")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("colValue")}
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium md:pr-3">
              {t("colPerTurn")}
            </th>
            <th scope="col" className="hidden w-2/5 py-2 pl-6 text-left font-medium md:table-cell">
              {t("colNotes")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-card-border/60 last:border-b-0">
              <th scope="row" className="py-3 pr-3 text-left align-baseline font-medium">
                <InfoTooltip
                  trigger={
                    <span className="text-foreground underline decoration-muted/50 decoration-dotted underline-offset-4">
                      {row.label}
                    </span>
                  }
                >
                  <div className="space-y-1 text-muted">{row.tooltip}</div>
                </InfoTooltip>
                {row.note && (
                  <span
                    className={`mt-0.5 block text-body-sm font-normal md:hidden ${TONE_CLASS[row.noteTone]}`}
                  >
                    {row.note}
                  </span>
                )}
              </th>
              <td className="whitespace-nowrap px-3 py-3 text-right align-baseline font-semibold tabular-nums text-foreground">
                {row.value}
              </td>
              <td
                className={`whitespace-nowrap py-3 pl-3 text-right align-baseline tabular-nums md:pr-3 ${TONE_CLASS[row.perTurnTone]}`}
              >
                {row.perTurn}
              </td>
              <td
                className={`hidden py-3 pl-6 align-baseline text-body-sm md:table-cell ${TONE_CLASS[row.noteTone]}`}
              >
                {row.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
