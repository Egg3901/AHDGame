"use client";

import { useState } from "react";
import { formatShare } from "@/lib/alignment/normalize";
import { BalanceBar } from "./influence/BalanceBar";
import { NationsInPlay } from "./influence/NationsInPlay";
import { NationDossier } from "./influence/NationDossier";
import type { OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { useFundFormatter } from "./useFundFormatter";

/**
 * The Influence tab: spend the org's pooled fund to pull a nation toward this
 * org's bloc. The tab is shown for every org — one that carries no influence
 * this era explains why, which beats a tab that appears and disappears.
 */
export function InfluenceTab({
  view,
  orgId,
  viewerCountryId,
  onChange,
}: {
  view: OrgInfluenceView;
  orgId: string;
  /** The viewer's foreign-minister country, or null when they hold no such seat. */
  viewerCountryId: string | null;
  onChange: () => void;
}) {
  // NationsInPlay owns the ordering, so the tab does not duplicate it — it
  // simply remembers which nation the player picked.
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Play amounts are a record of what was spent, not a field anyone types into,
  // so they read in the viewer's currency.
  const fundAmount = useFundFormatter(view);

  if (!view.enabled) {
    return (
      <Panel>
        <p className="text-body-sm text-muted">Bloc influence is not enabled in this world.</p>
      </Panel>
    );
  }

  if (!view.channel) {
    return (
      <Panel>
        <p className="text-body-sm text-muted">
          This organization carries no influence in {view.year}. Only blocs with a standing
          alignment channel can move a nation between the poles.
        </p>
      </Panel>
    );
  }

  const channel = view.channel;
  const selected = view.targets.find((t) => t.entityId === selectedEntityId) ?? null;

  return (
    <div className="space-y-5">
      <BalanceBar view={view} />

      {/* The rules for this tab are a wiki page nobody could find from here:
          the first question on ticket #1064 was "is there a wiki page for this?"
          and a moderator had to paste the link by hand. */}
      <p className="text-body-xs text-muted">
        Spending here moves a nation between the poles.{" "}
        <a
          href="https://wiki.ahousedividedgame.com/world-alignment"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          How world alignment works
        </a>
      </p>

      {viewerCountryId && view.targets.length === 0 && (
        <Panel>
          <p className="text-body-sm text-muted">
            There is no one left to court: every nation on record is locked to its bloc, and
            influence cannot move a locked nation.
          </p>
        </Panel>
      )}

      {view.targets.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
          <div className={selected ? "hidden lg:block" : undefined}>
            <NationsInPlay
              view={view}
              selectedEntityId={selectedEntityId}
              onSelect={setSelectedEntityId}
            />
          </div>

          {selected && (
            <div className="space-y-2">
              {/* A phone shows the dossier rather than making the player scroll
                  past the roster to reach it; the desktop grid keeps both. */}
              <button
                type="button"
                onClick={() => setSelectedEntityId(null)}
                className="text-body-xs text-muted hover:text-foreground lg:hidden"
              >
                &larr; Change nation
              </button>
              <NationDossier
                view={view}
                target={selected}
                orgId={orgId}
                viewerCountryId={viewerCountryId}
                onCommitted={onChange}
              />
            </div>
          )}
        </div>
      )}

      {/* Bloc stress. Surfaced because it DAMPENS the plays made above: money
          that quietly bought less, with no visible cause, reads as the game
          cheating rather than as pressure. */}
      {view.blocStress && (
        <Panel>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-body-sm font-semibold text-foreground">Bloc strain</h3>
            <span
              className={`rounded-md px-2 py-0.5 text-body-xs font-semibold ${
                view.blocStress.label === "Settled"
                  ? "bg-success/15 text-success"
                  : view.blocStress.label === "Strained"
                    ? "bg-warning/15 text-warning"
                    : "bg-error/15 text-error"
              }`}
            >
              {view.blocStress.label}
            </span>
          </div>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-card-border/40">
            <div
              className="h-full rounded-full bg-warning"
              style={{ width: `${Math.round(view.blocStress.stress * 100)}%` }}
            />
          </div>
          <p className="text-body-xs text-muted">
            {view.blocStress.effectiveness >= 1
              ? "This bloc is settled — its plays land at full strength."
              : `Plays land at ${Math.round(view.blocStress.effectiveness * 100)}% strength while the bloc is stretched.`}
          </p>
          <ul className="mt-2 space-y-0.5 text-body-xs text-muted/80">
            <li>Contested by a rival: {Math.round(view.blocStress.contested * 100)}% of members</li>
            <li>At the leave threshold: {Math.round(view.blocStress.wantsOut * 100)}%</li>
            <li>Still settling in: {Math.round(view.blocStress.digesting * 100)}%</li>
          </ul>
        </Panel>
      )}

      {view.members.length > 0 && (
        <Panel>
          <h3 className="mb-3 text-body-sm font-semibold text-foreground">
            Members&rsquo; standing
          </h3>
          <ul className="space-y-2">
            {view.members.map((m) => (
              <li key={m.countryId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-sm text-foreground">
                  {m.name}
                  {!m.hasVote && (
                    <span className="ml-2 text-body-xs text-muted">
                      {view.leviesTribute ? "· no vote, pays tribute" : "· no vote"}
                    </span>
                  )}
                </span>
                {!m.wantsOut || m.exempt ? (
                  <span className="font-mono text-body-xs tabular-nums text-muted">
                    {formatShare(m.share)} of {channel.poleLabel}
                    {m.exempt && m.wantsOut && " · founder"}
                  </span>
                ) : (
                  <span className="font-mono text-body-xs tabular-nums text-warning">
                    {formatShare(m.share)} of {channel.poleLabel} · at or below {view.leaveShare}
                    {m.turnsBelowGate != null &&
                      ` · ${m.turnsBelowGate}/${view.sustainTurns} turns`}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-body-xs text-muted">
            A member whose share falls to {view.leaveShare} and stays there for {view.sustainTurns}{" "}
            turns leaves the bloc; a nation that reaches {view.joinShare} for as long asks to join
            one. Nations a player is steering are warned rather than moved.
          </p>
        </Panel>
      )}

      <Panel>
        <h3 className="mb-3 text-body-sm font-semibold text-foreground">Recent plays</h3>
        {view.recent.length === 0 ? (
          <p className="text-body-sm text-muted">
            No influence has been committed through this organization yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse">
              <thead>
                <tr className="border-b border-card-border text-left">
                  <Th>Nation</Th>
                  <Th>By</Th>
                  <Th numeric>Spend</Th>
                  <Th numeric>Bought</Th>
                </tr>
              </thead>
              <tbody>
                {view.recent.map((p, i) => (
                  <tr
                    key={`${p.targetEntityId}-${p.turn}-${i}`}
                    className="border-b border-card-border/50 last:border-0"
                  >
                    <td className="px-2 py-2 text-body-sm text-foreground sm:px-3">
                      {p.targetName}
                    </td>
                    <td className="px-2 py-2 text-body-sm text-muted sm:px-3">
                      {p.sponsorCountryId}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-body-sm tabular-nums text-muted sm:px-3">
                      {fundAmount(p.amountLocal)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-body-sm tabular-nums sm:px-3">
                      {p.resolvedTurn == null ? (
                        <span className="text-muted">pending</span>
                      ) : p.refunded ? (
                        // Distinct from "0 pts": the money came back, and a row
                        // reading zero next to a spend looks like theft.
                        <span className="text-muted">refunded</span>
                      ) : (
                        `${p.appliedPoints ?? 0} pts`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">{children}</div>;
}

function Th({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      className={`px-2 pb-2 text-body-xs font-semibold uppercase tracking-wide text-muted sm:px-3 ${
        numeric ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}
