import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Character, State } from "@/lib/db/types";
import { InfoTooltip } from "@/components/InfoTooltip";
import { ACTION_HOARDING_PENALTY } from "@/lib/actions/recommendationsConstants";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { STAT_MIN } from "@/lib/stats/statsConstants";
import { ActionsTooltipBody } from "./PoliticalStanding";
import { SectionHeader } from "./ProfileMeters";

interface DossierScoreboardProps {
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
  nationalRank: number;
  baseActionsPerTurn?: number;
  officeActionBonus?: number;
  chairActionBonus?: number;
  actionBreakdown?: { label: string; amount: number }[];
  totalActionsPerTurn: number;
  actionHoarding: boolean;
  bonusActionsFromParty?: number;
  partyInfluenceMaxBonus?: number;
  partyInfluenceNetGain?: number;
  partyInfluenceShare?: number;
}

type Tone = "neutral" | "gain" | "loss";

interface Row {
  key: string;
  label: string;
  tooltip: ReactNode;
  value: string;
  perTurn: string | null;
  perTurnTone: Tone;
  note: ReactNode;
  noteTone?: Tone;
}

function signed(value: number, digits: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

/**
 * Record variant of Political Standing (experiment `profile-redesign`).
 * One row per measure: its value, its change per turn, and what it means.
 * Uses the site's card, section header and semantic colour tokens so it
 * follows the active theme; colour appears only on gains, losses and penalties.
 */
export function DossierScoreboard({
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
  nationalRank,
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
}: DossierScoreboardProps) {
  const t = useTranslations("profile.standing");
  const td = useTranslations("profile.dossier");
  const { cap: actionCap, threshold: hoardThreshold } = energyActionLimits(
    character.stats?.energy ?? STAT_MIN
  );
  const actionsPerTurn = totalActionsPerTurn + (bonusActionsFromParty ?? 0);
  const showParty = character.party && character.party !== "independent";

  const rows: Row[] = [
    {
      key: "favorability",
      label: t("favorability"),
      tooltip: <p>{t("favorabilityTooltip")}</p>,
      value: `${favorability.toFixed(1)}%`,
      perTurn: favDecayDisplay ? `−${favDecayDisplay}` : null,
      perTurnTone: "loss",
      note: favDecayDisplay ? td("favorabilityCooling") : td("favorabilityStable"),
    },
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
      perTurn: `+${actionsPerTurn}`,
      perTurnTone: "gain",
      note: actionHoarding
        ? td("hoarding", { penalty: ACTION_HOARDING_PENALTY })
        : td("hoardAbove", { threshold: hoardThreshold }),
      noteTone: actionHoarding ? "loss" : "neutral",
    },
    {
      key: "influence",
      label: td("stateInfluence"),
      tooltip: <p>{t("influenceTooltip")}</p>,
      value: `${influence.toFixed(1)}%`,
      perTurn: `−${influenceDecay}`,
      perTurnTone: "loss",
      note: homeState?.name ?? "",
    },
    {
      key: "national",
      label: td("nationalInfluence"),
      tooltip: <p>{t("nationalTooltip")}</p>,
      value: nationalInfluence.toFixed(1),
      perTurn: `+${nationalGainPerTurn}`,
      perTurnTone: "gain",
      note: nationalRank > 0 ? td("nationalRank", { rank: nationalRank }) : "",
    },
    {
      key: "infamy",
      label: t("infamy"),
      tooltip: <p>{t("infamyTooltip")}</p>,
      value: `${infamy.toFixed(1)}%`,
      perTurn: null,
      perTurnTone: "neutral",
      note: infamyPenalty ? td("infamyCost", { value: infamyPenalty }) : td("infamySafe"),
      noteTone: infamyPenalty ? "loss" : "neutral",
    },
  ];

  if (showParty) {
    rows.push({
      key: "party",
      label: td("partyInfluence"),
      tooltip: (
        <>
          <p>{t("partyInfluenceTooltip")}</p>
          {partyInfluenceShare != null && <p>{t("partyShare", { share: partyInfluenceShare })}</p>}
        </>
      ),
      value: (character.partyInfluence ?? 0).toFixed(1),
      perTurn: partyInfluenceNetGain != null ? signed(partyInfluenceNetGain, 1) : null,
      perTurnTone:
        partyInfluenceNetGain == null ? "neutral" : partyInfluenceNetGain >= 0 ? "gain" : "loss",
      note:
        bonusActionsFromParty != null
          ? td("partyBonus", { count: bonusActionsFromParty, max: partyInfluenceMaxBonus ?? 6 })
          : t("withinPartyStanding"),
    });
  }

  const toneClass: Record<Tone, string> = {
    neutral: "text-muted",
    gain: "text-success",
    loss: "text-error",
  };

  return (
    <section className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
      <div className="px-4 pt-5 pb-0 sm:px-6">
        <SectionHeader
          action={
            <Link
              href="/actions"
              className="text-xs font-medium text-primary/80 hover:text-primary hover:underline"
            >
              {t("campaignOffice")}
            </Link>
          }
        >
          {t("title")}
        </SectionHeader>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-card-border whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted">
            <th scope="col" className="px-4 pb-2 text-left font-semibold sm:px-6">
              {td("colMeasure")}
            </th>
            <th scope="col" className="px-2 pb-2 text-right font-semibold sm:px-3">
              {td("colValue")}
            </th>
            <th scope="col" className="pb-2 pl-2 pr-4 text-right font-semibold sm:pl-3 md:pr-3">
              {td("colPerTurn")}
            </th>
            <th
              scope="col"
              className="hidden w-2/5 px-6 pb-2 text-left font-semibold md:table-cell"
            >
              {td("colNotes")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-card-border/40 last:border-b-0 transition-colors hover:bg-card-elevated/40"
            >
              <th
                scope="row"
                className="px-4 py-3 text-left align-baseline font-semibold text-foreground sm:px-6"
              >
                <InfoTooltip trigger={<span className="cursor-help">{row.label}</span>}>
                  <div className="text-muted space-y-1">{row.tooltip}</div>
                </InfoTooltip>
                {row.note && (
                  <span
                    className={`mt-0.5 block text-xs font-normal md:hidden ${toneClass[row.noteTone ?? "neutral"]}`}
                  >
                    {row.note}
                  </span>
                )}
              </th>
              <td className="whitespace-nowrap px-3 py-3 text-right align-baseline font-bold tabular-nums text-foreground">
                {row.value}
              </td>
              <td
                className={`whitespace-nowrap py-3 pl-3 pr-4 text-right md:pr-3 align-baseline tabular-nums ${toneClass[row.perTurn ? row.perTurnTone : "neutral"]}`}
              >
                {row.perTurn}
              </td>
              <td
                className={`hidden px-6 py-3 align-baseline text-xs md:table-cell ${toneClass[row.noteTone ?? "neutral"]}`}
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
