import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Character, State } from "@/lib/db/types";
import { InfoTooltip } from "@/components/InfoTooltip";
import { ACTION_HOARDING_PENALTY } from "@/lib/actions/recommendationsConstants";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { STAT_MIN } from "@/lib/stats/statsConstants";
import { ActionsTooltipBody } from "./PoliticalStanding";

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

function Figure({
  label,
  tooltip,
  value,
  unit,
  note,
  noteTone = "neutral",
  meter,
  hero = false,
  children,
}: {
  label: string;
  tooltip: ReactNode;
  value: string;
  unit?: string;
  note?: ReactNode;
  noteTone?: Tone;
  /** 0 to 100 */
  meter?: number;
  hero?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={hero ? "dossier-figure dossier-figure-hero" : "dossier-figure"}>
      <InfoTooltip trigger={<span className="dossier-label">{label}</span>}>
        <div className="text-muted space-y-1">{tooltip}</div>
      </InfoTooltip>
      <p className="dossier-value">
        {value}
        {unit && <span className="dossier-unit">{unit}</span>}
      </p>
      {meter !== undefined && (
        <div className="dossier-meter" aria-hidden>
          <span style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} />
        </div>
      )}
      {note && <p className={`dossier-note dossier-note-${noteTone}`}>{note}</p>}
      {children}
    </div>
  );
}

/**
 * Dossier variant of Political Standing (experiment `profile-redesign`):
 * the numbers are the content, set as large tabular figures. Colour is used
 * only where it means something: gains, losses, and penalties.
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
  maxNPI,
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
  const partyInfluence = character.partyInfluence ?? 0;

  return (
    <section className="dossier-panel">
      <header className="dossier-panel-head">
        <h2>{t("title")}</h2>
        <Link href="/actions" className="dossier-cta">
          {t("campaignOffice")}
        </Link>
      </header>

      <div className="dossier-figures-hero">
        <Figure
          hero
          label={t("favorability")}
          tooltip={<p>{t("favorabilityTooltip")}</p>}
          value={favorability.toFixed(1)}
          unit="%"
          meter={favorability}
          note={favDecayDisplay ? t("decay", { value: favDecayDisplay }) : t("publicApproval")}
          noteTone={favDecayDisplay ? "loss" : "neutral"}
        />
        <Figure
          hero
          label={t("actions")}
          tooltip={
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
          }
          value={String(character.actions)}
          unit={`/ ${actionCap}`}
          meter={(character.actions / actionCap) * 100}
          note={
            <>
              {t("perTurn", { count: actionsPerTurn })}
              {actionHoarding && (
                <span className="dossier-note-loss">
                  {" "}
                  {t("hoardTag", { penalty: ACTION_HOARDING_PENALTY })}
                </span>
              )}
            </>
          }
          noteTone="gain"
        />
      </div>

      <div className="dossier-figures">
        <Figure
          label={t("influence")}
          tooltip={<p>{t("influenceTooltip")}</p>}
          value={influence.toFixed(1)}
          unit="%"
          meter={influence}
          note={
            <>
              {homeState?.name && (
                <span className="dossier-note-neutral">{homeState.name} &middot; </span>
              )}
              {t("decay", { value: influenceDecay })}
            </>
          }
          noteTone="loss"
        />
        <Figure
          label={t("national")}
          tooltip={<p>{t("nationalTooltip")}</p>}
          value={nationalInfluence.toFixed(1)}
          meter={maxNPI > 0 ? (nationalInfluence / maxNPI) * 100 : 0}
          note={
            <>
              {nationalRank > 0 && (
                <span className="dossier-note-neutral">
                  {td("nationalRank", { rank: nationalRank })} &middot;{" "}
                </span>
              )}
              {t("gain", { value: nationalGainPerTurn })}
            </>
          }
          noteTone="gain"
        />
        <Figure
          label={t("infamy")}
          tooltip={<p>{t("infamyTooltip")}</p>}
          value={infamy.toFixed(1)}
          unit="%"
          meter={infamy}
          note={infamyPenalty ? t("infamyFavPenalty", { value: infamyPenalty }) : t("safe")}
          noteTone={infamyPenalty ? "loss" : "neutral"}
        />
        {showParty && (
          <Figure
            label={td("partyInfluence")}
            tooltip={
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
                {partyInfluenceShare != null && (
                  <p>{t("partyShare", { share: partyInfluenceShare })}</p>
                )}
              </>
            }
            value={partyInfluence.toFixed(1)}
            meter={partyInfluence}
            note={
              partyInfluenceNetGain != null
                ? t("netPerTurn", {
                    value: `${partyInfluenceNetGain >= 0 ? "+" : ""}${partyInfluenceNetGain.toFixed(1)}`,
                  })
                : t("withinPartyStanding")
            }
            noteTone={
              partyInfluenceNetGain == null
                ? "neutral"
                : partyInfluenceNetGain >= 0
                  ? "gain"
                  : "loss"
            }
          />
        )}
      </div>
    </section>
  );
}
