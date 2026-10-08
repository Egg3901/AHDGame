"use client";

import { useMemo, type ReactNode } from "react";
import { BlendShell } from "@/components/blend/BlendShell";
import { BlendTicker } from "@/components/blend/BlendTicker";
import { BLEND, FONT } from "@/components/blend/tokens";
import type { ContingentElectionDisplay } from "@/lib/elections/presidentialResolutionDisplay";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { PresidentialMap } from "../blend/presMap/PresidentialMap";
import {
  CallAlertBanner,
  CandidateTotals,
  KeyRaces,
  NextClosing,
  NightFeed,
  NightHeader,
  NightMapLegend,
  RaceBar,
  SettledPanel,
} from "./NightParts";
import { NightStatePanel } from "./NightStatePanel";
import { buildNightMapModel } from "./nightMapModel";
import { buildNightFeed, buildNightView, formatEtClock, nightClockHour } from "./nightModel";
import { nightWindowRealMs, useCallAlerts, useNightProgress } from "./useNightBroadcast";

export interface NightBroadcastProps {
  data: ElectionResultsResponse;
  /** Contingent ballot detail, when the election detail is at hand (resolved races). */
  contingent?: { result?: ContingentElectionDisplay };
  /** Where the concluded results live. */
  concludedHref: string;
  /** Leave the settled broadcast in place (detail page); otherwise a link is shown. */
  onContinue?: () => void;
  /** Rendered above the header (the admin replay banner). */
  banner?: ReactNode;
}

const CSS = `
  .night-alert-dock { position: sticky; bottom: 16px; height: 0; z-index: 30; pointer-events: none; }
  .night-alert-dock > div { position: absolute; left: 18px; right: 18px; bottom: 0; max-width: 520px; pointer-events: auto; }
  .night-mobile-only { display: block; }
  @media (min-width: 1024px) { .night-mobile-only { display: none; } }
  @media (max-width: 1023px) {
    .night-alert-dock { position: fixed; left: 12px; right: 12px; bottom: 12px; height: auto; }
    .night-alert-dock > div { position: static; max-width: none; }
    .night-alert__title { font-size: 14px !important; }
  }
`;

/**
 * The election-night broadcast: the whole presidential screen while the final
 * hour plays out, and the settled board once the race resolves. Reads only the
 * results payload, whose numbers are already fogged server-side.
 */
export function NightBroadcast({
  data,
  contingent,
  concludedHref,
  onContinue,
  banner,
}: NightBroadcastProps) {
  const view = useMemo(() => buildNightView(data), [data]);
  const feed = useMemo(() => buildNightFeed(data), [data]);
  const progress = useNightProgress(data);
  const { active, dismiss } = useCallAlerts(data);
  const night = data.election.night ?? null;
  const settled = view.settled;

  const model = useMemo(
    () =>
      buildNightMapModel(data, settled, {
        pulseStateId: active?.stateId ?? null,
        pulseToken: active?.key,
      }),
    [data, settled, active]
  );

  const clock = settled ? null : formatEtClock(nightClockHour(progress));
  const title = `${data.election.electionYear ?? ""} Presidential election`.trim();
  const candidateName = (id: string) => data.candidates.find((c) => c.id === id)?.name ?? "Unknown";
  const tickerItems = settled
    ? [`Final: all ${view.totalStates} states called, 100% reporting`]
    : feed.slice(0, 10).map((f) => `${f.clock} ${f.text}`);
  const windowRealMs = nightWindowRealMs(data);

  const rail = (
    <aside aria-label="Election night details">
      <NextClosing view={view} night={night} progress={progress} windowRealMs={windowRealMs} />
      <CandidateTotals view={view} />
      <NightFeed items={feed} />
    </aside>
  );

  return (
    <div
      style={{
        background: BLEND.page,
        color: BLEND.ink,
        fontFamily: FONT.sans,
        minHeight: "100vh",
      }}
    >
      <style>{CSS}</style>
      {banner}
      <NightHeader title={title} clock={clock} view={view} />
      <BlendTicker tag={settled ? "FINAL" : "RETURNS"} items={tickerItems} />
      <BlendShell fullBleed right={rail} rightWidth={340}>
        <RaceBar view={view} />
        {settled ? (
          <SettledPanel
            view={view}
            candidateName={candidateName}
            contingent={contingent}
            href={concludedHref}
            onContinue={onContinue}
          />
        ) : null}
        <div style={{ padding: "16px 18px" }}>
          <PresidentialMap
            model={model}
            electionId={data.election.id}
            countryId={data.election.countryId}
            turn={data.election.currentTurn}
            renderPanel={(state, close) => (
              <NightStatePanel
                state={state}
                model={model}
                electionId={data.election.id}
                countryId={data.election.countryId}
                turn={data.election.currentTurn}
                settled={settled}
                onClose={close}
              />
            )}
            legend={<NightMapLegend candidates={view.candidates} />}
          />
          {active ? (
            <div className="night-alert-dock">
              <div>
                <CallAlertBanner alert={active} view={view} onDismiss={dismiss} />
              </div>
            </div>
          ) : null}
        </div>
        <KeyRaces races={view.keyRaces} />
        <div className="night-mobile-only">
          <NextClosing view={view} night={night} progress={progress} windowRealMs={windowRealMs} />
          <CandidateTotals view={view} />
          <NightFeed items={feed} collapsible />
        </div>
      </BlendShell>
    </div>
  );
}
