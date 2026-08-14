"use client";

import { useReducer } from "react";
import { Button } from "@/components/ui";
import type { BankCharterType } from "@/lib/db/types/bank";
import type { ConsolePayload, ShowToast } from "../types";
import { charterLabel, mergeState } from "../lib/helpers";

/** Retail and universal charters take deposits; investment charters do not. */
function takesDeposits(type: BankCharterType): boolean {
  return type === "retail" || type === "universal";
}

/**
 * CEO control to change an existing bank's charter type in place (retail ↔
 * universal ↔ investment). Calls PATCH /api/corporations/[id]/bank/charter,
 * which is fully authorized and money-safe server-side (`switchCharterType`):
 * moving to an investment charter returns the whole deposit book with
 * conservation, and a 24-turn cooldown then locks the type. This form only
 * surfaces that existing capability — the backend was reachable by no UI before,
 * which is why a chartered CEO could not find the option (ticket 1069).
 */
export function CharterSwitchForm({
  data,
  canMutate,
  onChanged,
  showToast,
}: {
  data: ConsolePayload;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const charter = data.charter;

  // Types the bank could switch INTO: every legal type except its current one.
  const options = (data.legalCharterTypes ?? []).filter((t) => t !== charter?.type);

  const [{ type, busy }, update] = useReducer(
    mergeState<{ type: BankCharterType; busy: boolean }>,
    { type: options[0] ?? ("retail" as BankCharterType), busy: false }
  );

  if (!charter) return null;

  const cooldownUntil = charter.charterSwitchCooldownUntilTurn;
  const turnsRemaining =
    cooldownUntil != null && data.currentTurn < cooldownUntil
      ? cooldownUntil - data.currentTurn
      : 0;
  const onCooldown = turnsRemaining > 0;

  // Switching from a deposit-taking charter to one that cannot hold deposits
  // returns the entire book. Warn before that is irreversible-in-cost.
  const willReturnDeposits =
    takesDeposits(charter.type) && !takesDeposits(type) && charter.totalDeposits > 0;

  const submit = async () => {
    if (willReturnDeposits) {
      const ok = window.confirm(
        "Switching to an investment charter returns your entire deposit book: player savings go " +
          "back to the central bank and household deposits return to circulation. Nobody loses money, " +
          "but you lose the funding base and cannot switch back for 24 turns. Continue?"
      );
      if (!ok) return;
    }
    update({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${data.corporation.id}/bank/charter`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        reasons?: string[];
        npcDepositsReturned?: number;
        depositorsFlipped?: number;
      };
      if (!res.ok) {
        showToast(json.reasons?.join("; ") ?? json.error ?? "Could not switch charter", "error");
        return;
      }
      showToast(`Charter switched to ${charterLabel(type)}`, "success");
      await onChanged();
    } finally {
      update({ busy: false });
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Change charter type</h3>
        <p className="mt-1 text-sm text-muted">
          Change what kind of bank you run without re-chartering or re-posting capital. Switching to
          an investment charter returns your whole deposit book. A 24-turn cooldown applies after
          any switch.
        </p>
      </div>

      {options.length === 0 ? (
        <p className="text-sm text-muted">
          No other charter type is legal in this jurisdiction to switch to.
        </p>
      ) : (
        <>
          <label className="block space-y-1 text-xs text-muted">
            Switch to
            <select
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
              value={type}
              onChange={(e) => update({ type: e.target.value as BankCharterType })}
              disabled={!canMutate || onCooldown}
              aria-label="New charter type"
            >
              {options.map((t) => (
                <option key={t} value={t}>
                  {charterLabel(t)}
                </option>
              ))}
            </select>
          </label>

          {onCooldown ? (
            <p className="text-sm text-muted">
              Charter type is locked for {turnsRemaining} more turn{turnsRemaining === 1 ? "" : "s"}{" "}
              after your last switch.
            </p>
          ) : canMutate ? (
            <Button type="button" onClick={() => void submit()} disabled={busy}>
              {busy ? "Switching..." : `Switch to ${charterLabel(type)}`}
            </Button>
          ) : (
            <p className="text-sm text-muted">
              Only the bank&apos;s CEO can change the charter type.
            </p>
          )}
        </>
      )}
    </section>
  );
}
