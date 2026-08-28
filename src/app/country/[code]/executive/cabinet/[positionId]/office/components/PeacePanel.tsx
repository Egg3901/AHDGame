"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionCard, Badge } from "./dossier";
import { COUNTRY_CONFIGS, type CountryId, type GovernmentType } from "@/lib/constants/countries";
import { PEACE_OFFER_DURATION_TURNS, TRUCE_TURNS } from "@/lib/db/types/peaceOffer";
import type { PeaceTerm } from "@/lib/military/peaceTerm";

interface OfferView {
  id: string;
  conflictId: string;
  fromCountry: CountryId;
  toCountry: CountryId;
  /** Which party the deal removes. Absent on rows written before offers ran both ways. */
  leaver?: CountryId;
  term: PeaceTerm;
  justification: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn" | "expired";
  offeredTurn: number;
  expiresTurn: number;
  incoming: boolean;
}

/** One country that can be offered terms, with the withdrawal gate's verdict. */
export interface EnemyView {
  country: CountryId;
  /** Asking them to withdraw would empty their side and end the war. */
  endsWar: boolean;
  /** Treaty allies released alongside them, who leave at the same moment. */
  guestsLeaving: CountryId[];
  /** That withdrawal is refused at the current front. A white peace escapes it. */
  withdrawalBlocked: boolean;
  progressPct: number;
  requiredPct: number;
}

export interface PeaceWar {
  /** ConflictDoc._id — what the API keys offers by. */
  conflictId: string;
  /** Public number, for the /world/conflicts/<n> link. */
  conflictNumber: number;
  name: string;
  /** Countries on the OTHER side, the only ones an offer can be made to. */
  enemies: EnemyView[];
  /** What OUR leaving would do to this war. */
  ourDeparture: { endsWar: boolean; guestsLeaving: CountryId[] };
}

/**
 * Sue for peace, and answer offers made to us.
 *
 * Lives on the foreign seat's OVERVIEW tab, deliberately not the "Foreign Relations"
 * tab: that tab is gated to US/UK/JP by `FOREIGN_POSITION_IDS`, so putting peace
 * behind it would make the feature unreachable for every other country that has a
 * foreign minister.
 *
 * Spec: docs/superpowers/specs/2026-08-04-suing-for-peace-design.md
 */
/**
 * What an offer is asking for, as one clause appended to who is offering.
 *
 * Handles EVERY term, not only an indemnity: the routes accept all three, so an
 * incoming offer can carry any of them and a panel that only knew about money
 * would render an empty demand. Player-facing copy, so no em or en dashes.
 *
 * An indemnity names whose currency the figure is in, because the amount is
 * quoted in the PAYER's currency, which is not always the reader's.
 */
function offerTermText(term: PeaceTerm): string {
  if (term.kind === "white_peace") return " on white peace terms, with nothing changing hands";
  if (term.kind === "indemnity") {
    if (!(term.amount > 0)) return " with no indemnity, a white peace";
    const payerName = COUNTRY_CONFIGS[term.payer]?.name ?? term.payer;
    return ` for ${term.amount.toLocaleString("en-US")} from ${payerName} (in ${payerName} currency)`;
  }
  if (term.kind === "regime_change") {
    return " in return for a change of government and fresh elections";
  }
  return ` in return for freezing new defence procurement for ${term.turns} turns`;
}

/**
 * What this offer is proposing, from the reader's side of it.
 *
 * An offer runs in both directions now, so describing every one as the sender
 * offering to leave would state a withdrawal demand backwards: "East Germany offers
 * to leave" when what East Germany actually said was "you leave".
 *
 * `leaver` is optional because a row written before offers ran both ways carries
 * none; those all meant the sender, which is the fallback.
 */
function offerDirectionText(o: OfferView): string {
  const senderLeaves = (o.leaver ?? o.fromCountry) === o.fromCountry;
  if (senderLeaves) {
    return o.incoming ? " offers to leave the war" : ", our offer to leave the war";
  }
  const leaverName = COUNTRY_CONFIGS[o.leaver ?? o.toCountry]?.name ?? o.leaver;
  return o.incoming
    ? ` asks us to leave the war, staying in it themselves`
    : `, our request that ${leaverName} leave the war`;
}

/**
 * What accepting THIS offer would actually do to the war, named for the reader.
 *
 * The panel used to state flatly that "the fighting continues for everyone else",
 * which is only sometimes true and was plainly wrong in the shape that prompted this:
 * a side of one, facing a side whose principal takes its treaty ally out with it.
 * EITHER departure ends that war, and a player reading the old line would have
 * expected the survivors to fight on.
 */
function departureConsequence(leaverName: string, endsWar: boolean, guests: CountryId[]): string {
  const released =
    guests.length > 0
      ? ` ${guests.map((g) => COUNTRY_CONFIGS[g]?.name ?? g).join(" and ")} ${
          guests.length === 1 ? "leaves" : "leave"
        } at the same moment, released from the treaty that brought ${
          guests.length === 1 ? "it" : "them"
        } in.`
      : "";
  return endsWar
    ? `Accepting ends this war outright: nobody would be left on ${leaverName}'s side.${released}`
    : `Accepting takes ${leaverName} out and the fighting continues for everyone else.${released}`;
}

export function PeacePanel({
  countryCode,
  countryId,
  canAct,
}: {
  countryCode: string;
  countryId: CountryId;
  canAct: boolean;
}) {
  const [wars, setWars] = useState<PeaceWar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [warId, setWarId] = useState<string>("");
  const [offers, setOffers] = useState<OfferView[]>([]);
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  const [enemy, setEnemy] = useState<string>("");
  const [payer, setPayer] = useState<CountryId>(countryId);
  const [amount, setAmount] = useState<string>("0");
  /** Who this deal removes: us, or the country we are addressing. */
  const [leaver, setLeaver] = useState<"us" | "them">("us");
  const [termKind, setTermKind] = useState<
    "white_peace" | "indemnity" | "regime_change" | "demilitarisation"
  >("indemnity");
  const [targetSystem, setTargetSystem] = useState<string>("parliamentaryRepublic");
  const [demilTurns, setDemilTurns] = useState<string>("240");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const war = wars.find((w) => w.conflictId === warId);
  const selectedEnemy = war?.enemies.find((e) => e.country === enemy) ?? null;
  /**
   * The gate bites only when we are asking THEM to leave and the term is not a white
   * peace. A white peace records no victor, so there is nothing to buy and nothing to
   * gate: the form must not block the one route that is always open.
   */
  const withdrawalBarred =
    leaver === "them" && termKind !== "white_peace" && selectedEnemy?.withdrawalBlocked === true;

  /**
   * Changing who we are negotiating with resets who pays.
   *
   * "They pay" names the CURRENT enemy, so leaving `payer` alone would keep the
   * previous one selected — a country that is not a party to this offer. The select
   * would render blank while state still held the stale id, and the server would
   * refuse with "only one of the two parties can pay", which reads as a bug.
   */
  function chooseEnemy(next: string) {
    setEnemy(next);
    setPayer(countryId);
  }

  // One call carries both the wars and every offer touching them, so selecting a
  // different war needs no refetch.
  const load = useCallback(async () => {
    const res = await fetch(`/api/country/${countryCode}/executive/peace`);
    setLoaded(true);
    if (!res.ok) return;
    const body = (await res.json()) as {
      wars: PeaceWar[];
      offers: OfferView[];
      currentTurn: number;
    };
    setWars(body.wars);
    setOffers(body.offers);
    setCurrentTurn(body.currentTurn);
    setWarId((prev) =>
      prev && body.wars.some((w) => w.conflictId === prev) ? prev : (body.wars[0]?.conflictId ?? "")
    );
  }, [countryCode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(url: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        warResolved?: boolean;
      } | null;
      if (!res.ok) {
        setError(payload?.error ?? "That could not be done.");
        return;
      }
      setNote(payload?.warResolved ? "Accepted. The war is over." : done);
      await load();
    } catch {
      setError("That could not be done.");
    } finally {
      setBusy(false);
    }
  }

  const offer = () =>
    send(
      `/api/country/${countryCode}/executive/peace`,
      {
        conflictId: warId,
        toCountry: enemy,
        term: buildTerm(),
        leaver,
        ...(justification.trim() ? { justification: justification.trim() } : {}),
      },
      "Offer sent."
    );

  const answer = (id: string, action: "accept" | "reject" | "withdraw") =>
    send(`/api/country/${countryCode}/executive/peace/${id}`, { action }, `Offer ${action}ed.`);

  if (wars.length === 0) {
    return (
      <SectionCard title="Peace negotiations" sub="Ending a war your country is fighting">
        <p className="text-[12px] text-muted">
          {loaded ? "Your country is not at war." : "Loading…"}
        </p>
      </SectionCard>
    );
  }

  // Scoped to the selected war: the payload carries offers for every war at once.
  const forWar = offers.filter((o) => o.conflictId === warId);
  // Safe to read `status` alone here ONLY because the API already derived it through
  // isOfferLive — a row stored as "pending" past its window arrives as "expired".
  // Anywhere reading the raw document, that comparison would be a bug.
  const live = forWar.filter((o) => o.status === "pending");
  const past = forWar.filter((o) => o.status !== "pending");
  const payerName = COUNTRY_CONFIGS[payer]?.name ?? payer;

  /** The one term this offer carries, matching the server's discriminated union. */
  function buildTerm(): PeaceTerm {
    if (termKind === "white_peace") {
      return { kind: "white_peace" };
    }
    if (termKind === "regime_change") {
      return { kind: "regime_change", targetSystem: targetSystem as GovernmentType };
    }
    if (termKind === "demilitarisation") {
      return { kind: "demilitarisation", turns: Number(demilTurns) || 0 };
    }
    return { kind: "indemnity", payer, amount: Number(amount) || 0 };
  }

  return (
    <SectionCard
      title="Peace negotiations"
      sub="Ending a war your country is fighting"
      right={!canAct ? <Badge tone="muted">Read-only</Badge> : undefined}
    >
      <p className="mb-3 text-[12px] text-muted">
        A deal is struck between two countries, not two sides: accepting takes{" "}
        <strong>one country</strong> out of the war. An ally pulled in under a treaty leaves with
        the country it came to defend, and if that empties a side, the war ends there and then. An
        offer stands for {PEACE_OFFER_DURATION_TURNS} turns. Accepting starts a {TRUCE_TURNS}-turn
        truce, which neither side can trade away.
      </p>

      {wars.length > 1 && (
        <select
          aria-label="War"
          value={warId}
          onChange={(e) => {
            setWarId(e.target.value);
            chooseEnemy("");
          }}
          className="mb-3 w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
        >
          {wars.map((w) => (
            <option key={w.conflictId} value={w.conflictId}>
              {w.name}
            </option>
          ))}
        </select>
      )}

      {war && (
        <p className="mb-3 text-[11px]">
          <a
            href={`/world/conflicts/${war.conflictNumber}`}
            className="text-muted underline hover:text-foreground"
          >
            View the public record for {war.name} →
          </a>
        </p>
      )}

      {live.length > 0 && (
        <div className="mb-4 space-y-2">
          {live.map((o) => (
            <div key={o.id} className="rounded-lg border border-card-border bg-card-elevated p-3">
              <p className="text-[12px]">
                <strong>{COUNTRY_CONFIGS[o.fromCountry]?.name ?? o.fromCountry}</strong>
                {offerDirectionText(o)}
                {offerTermText(o.term)}.
              </p>
              {o.justification && (
                <p className="mt-1 border-l-2 border-card-border pl-2 text-[11px] italic text-muted">
                  {o.justification}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted">Lapses on turn {o.expiresTurn}.</p>
              {canAct && (
                <div className="mt-2 flex gap-2">
                  {o.incoming ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => answer(o.id, "accept")}
                        className="rounded-lg bg-success px-3 py-1.5 text-[11px] font-bold text-[#06210f] disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => answer(o.id, "reject")}
                        className="rounded-lg border border-card-border px-3 py-1.5 text-[11px] disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => answer(o.id, "withdraw")}
                      className="rounded-lg border border-card-border px-3 py-1.5 text-[11px] disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canAct && (
        <div className="space-y-2 border-t border-card-border pt-3">
          <p className="text-[12px] font-semibold">Offer to leave this war</p>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Country to negotiate with"
              value={enemy}
              onChange={(e) => chooseEnemy(e.target.value)}
              className="min-w-[150px] flex-1 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
            >
              <option value="">Select a country…</option>
              {(war?.enemies ?? []).map((e) => (
                <option key={e.country} value={e.country}>
                  {COUNTRY_CONFIGS[e.country]?.name ?? e.country}
                  {/* Named in the option itself, so the constraint is visible while
                      choosing rather than only after choosing. The option stays
                      selectable: a white peace with this country is always allowed. */}
                  {e.withdrawalBlocked ? " (cannot be made to leave yet)" : ""}
                </option>
              ))}
            </select>
            <select
              aria-label="Who leaves"
              value={leaver}
              onChange={(e) => setLeaver(e.target.value as "us" | "them")}
              className="min-w-[150px] flex-1 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
            >
              <option value="us">We leave the war</option>
              <option value="them">They leave the war</option>
            </select>
            <select
              aria-label="Term offered"
              value={termKind}
              onChange={(e) => setTermKind(e.target.value as typeof termKind)}
              className="min-w-[150px] flex-1 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
            >
              <option value="white_peace">White peace</option>
              <option value="indemnity">Indemnity</option>
              <option value="regime_change">Regime change</option>
              <option value="demilitarisation">Demilitarisation</option>
            </select>
          </div>

          {/* Exactly one term travels. The server payload is a discriminated union,
              so the fields below are the branch, not extra options alongside it. */}
          {termKind === "indemnity" && (
            <>
              <select
                aria-label="Who pays"
                value={payer}
                onChange={(e) => setPayer(e.target.value as CountryId)}
                className="w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
              >
                <option value={countryId}>We pay</option>
                {enemy && <option value={enemy}>They pay</option>}
              </select>
              <label className="block text-[11px] text-muted">
                Indemnity, in {payerName} currency. Zero is a white peace.
                <input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
                />
              </label>
            </>
          )}

          {termKind === "regime_change" && (
            <label className="block text-[11px] text-muted">
              System they would adopt. Their legislature is dissolved and fresh elections are
              called.
              <select
                aria-label="New system"
                value={targetSystem}
                onChange={(e) => setTargetSystem(e.target.value)}
                className="mt-1 w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
              >
                <option value="parliamentaryRepublic">Parliamentary republic</option>
                <option value="presidential">Presidential republic</option>
                <option value="onePartyState">One-party state</option>
              </select>
            </label>
          )}

          {selectedEnemy && war && (
            <p className="text-[11px] text-muted">
              {leaver === "them"
                ? departureConsequence(
                    COUNTRY_CONFIGS[selectedEnemy.country]?.name ?? selectedEnemy.country,
                    selectedEnemy.endsWar,
                    selectedEnemy.guestsLeaving
                  )
                : departureConsequence(
                    COUNTRY_CONFIGS[countryId]?.name ?? countryId,
                    war.ourDeparture.endsWar,
                    war.ourDeparture.guestsLeaving
                  )}
            </p>
          )}

          {leaver === "them" && !withdrawalBarred && (
            <p className="text-[11px] text-muted">
              They withdraw and we keep fighting. A withdrawal that would end the war outright needs
              the front well in our favour first, unless it is a white peace.
            </p>
          )}

          {withdrawalBarred && selectedEnemy && (
            <p
              role="alert"
              className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning"
            >
              {COUNTRY_CONFIGS[selectedEnemy.country]?.name ?? selectedEnemy.country} leaving would
              end this war outright, so it cannot simply be bought. The front is{" "}
              <strong>{selectedEnemy.progressPct}%</strong> of the way into their ground and must
              reach <strong>{selectedEnemy.requiredPct}%</strong> before you can demand it. A white
              peace is allowed at any point, and ends the war with no winner recorded.
            </p>
          )}

          {termKind === "white_peace" && (
            <p className="text-[11px] text-muted">
              The war ends where it began. Neither side is recorded as having won, nothing changes
              hands, and anything it was being fought over goes back to being an open question.
            </p>
          )}

          {termKind === "demilitarisation" && (
            <label className="block text-[11px] text-muted">
              Turns they may award no new defence contracts. Existing orders keep delivering.
              <input
                type="number"
                min={1}
                aria-label="Demilitarisation turns"
                value={demilTurns}
                onChange={(e) => setDemilTurns(e.target.value)}
                className="mt-1 w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
              />
            </label>
          )}

          <textarea
            aria-label="Justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Why you are seeking terms (optional, public once accepted)"
            className="w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[12px]"
          />

          <button
            type="button"
            onClick={offer}
            disabled={busy || !enemy || !warId || withdrawalBarred}
            className="w-full rounded-lg bg-[var(--gov)] py-2.5 text-[12px] font-bold text-[#1a1200] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send peace offer"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[11px] text-error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-2 text-[11px] text-success">
          {note}
        </p>
      )}

      {past.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-muted">
            Earlier offers ({past.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {past.map((o) => (
              <li key={o.id} className="text-[11px] text-muted">
                {COUNTRY_CONFIGS[o.fromCountry]?.name ?? o.fromCountry} →{" "}
                {COUNTRY_CONFIGS[o.toCountry]?.name ?? o.toCountry}: {o.status} (turn{" "}
                {o.offeredTurn})
              </li>
            ))}
          </ul>
        </details>
      )}

      {currentTurn !== null && (
        <p className="mt-2 text-[10px] text-muted">Current turn {currentTurn}.</p>
      )}
    </SectionCard>
  );
}
