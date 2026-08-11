"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuthMe } from "@/contexts/AuthDataContext";
import {
  RELOCATION_COST_FRACTION,
  CROSS_COUNTRY_RELOCATION_MULTIPLIER,
} from "@/lib/constants/corporations";

interface CorpRelocation {
  corpId: string;
  corpName: string;
  currentHqState: string;
  currentCountryId: string;
  isImperialCeo: boolean;
  marketCap: number;
  liquidCapitalAnchor: number;
  bondCooldownTurnsRemaining: number | null;
  bondLeverageAvailable: number;
}

interface RelocationStatus {
  canRelocate: boolean;
  cooldownRemainingDays: number | null;
  hasOffice: boolean;
  isCeo: boolean;
  ceoCorpName: string | null;
  homeState: string | null;
  activeCandidacies: { generalElections: number; statePartyElections: number };
  corpRelocation: CorpRelocation | null;
}

interface RelocateButtonProps {
  /** State/region ID as stored in DB (e.g. "CA", "LON") */
  targetStateId: string;
  /** Display name of the target (e.g. "California", "London") */
  targetName: string;
  /** User's current home state/region, or null if no character */
  userHomeState: string | null | undefined;
  /** Path to redirect after relocation */
  redirectPath: string;
  /** User's current countryId - used to preview cross-country consequences */
  userCountryId?: string | null;
  /** Target state/region countryId - used to preview cross-country consequences */
  targetCountryId?: string | null;
}

type PaymentMethod = "cash" | "bond";
type CorpRelocationChoice = "move" | "abandon";

export function RelocateButton({
  targetStateId,
  targetName,
  userHomeState,
  redirectPath,
  userCountryId,
  targetCountryId,
}: RelocateButtonProps) {
  const router = useRouter();
  const { formatAmount } = useCurrency();
  const { refetch } = useAuthMe();
  const [status, setStatus] = useState<RelocationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [corpChoice, setCorpChoice] = useState<CorpRelocationChoice | null>(null);

  function resetConfirmState() {
    setConfirming(false);
    setError(null);
    setPayment("cash");
    setCorpChoice(null);
  }

  useEffect(() => {
    if (!confirming) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) resetConfirmState();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirming, loading]);

  useEffect(() => {
    if (!userHomeState) return;
    fetch("/api/character/relocate")
      .then((r) => r.json())
      .then((data) => {
        setStatus({
          canRelocate: data.canRelocate ?? false,
          cooldownRemainingDays: data.cooldownRemainingDays ?? null,
          hasOffice: data.hasOffice ?? false,
          isCeo: data.isCeo ?? false,
          ceoCorpName: data.ceoCorpName ?? null,
          homeState: data.homeState ?? null,
          activeCandidacies: data.activeCandidacies ?? {
            generalElections: 0,
            statePartyElections: 0,
          },
          corpRelocation: data.corpRelocation ?? null,
        });
      })
      .catch(() => setStatus(null));
  }, [userHomeState]);

  const isCurrentHome = userHomeState === targetStateId;
  const showButton = userHomeState != null && !isCurrentHome && status != null;

  const isCountryChange = !!userCountryId && !!targetCountryId && userCountryId !== targetCountryId;

  const corp = status?.corpRelocation ?? null;
  const corpCrossCountry = !!corp && !!targetCountryId && corp.currentCountryId !== targetCountryId;
  const corpCost = corp
    ? Math.round(
        corp.marketCap *
          RELOCATION_COST_FRACTION *
          (corpCrossCountry ? CROSS_COUNTRY_RELOCATION_MULTIPLIER : 1)
      )
    : 0;
  const canPayCash = !!corp && corp.liquidCapitalAnchor >= corpCost;
  const bondCooldownTurns = corp?.bondCooldownTurnsRemaining ?? null;
  const canIssueBond =
    !!corp && bondCooldownTurns === null && corp.bondLeverageAvailable >= corpCost;
  const canMoveCorp =
    !!corp && !corp.isImperialCeo && (payment === "cash" ? canPayCash : canIssueBond);

  const cooldownActive = status?.cooldownRemainingDays != null;
  const disabled = !status?.canRelocate || cooldownActive;
  const tooltip = cooldownActive
    ? `Cooldown: ${status!.cooldownRemainingDays} day(s) remaining`
    : undefined;

  const { generalElections, statePartyElections } = status?.activeCandidacies ?? {
    generalElections: 0,
    statePartyElections: 0,
  };
  const totalCandidacies = generalElections + statePartyElections;
  const candidacyBreakdown: string[] = [];
  if (generalElections > 0) {
    candidacyBreakdown.push(
      `${generalElections} general/primary election${generalElections === 1 ? "" : "s"}`
    );
  }
  if (statePartyElections > 0) {
    candidacyBreakdown.push(
      `${statePartyElections} state-party election${statePartyElections === 1 ? "" : "s"}`
    );
  }

  async function submit(mode: "character-only" | "combined" | "imperial-combined") {
    setLoading(true);
    setError(null);
    try {
      if (mode === "character-only") {
        const res = await fetch("/api/character/relocate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetStateId,
            // Pass target country so the server can scope the state lookup
            // against cross-country state-ID collisions (CN HB / DE HB).
            ...(targetCountryId ? { targetCountryId } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Relocation failed");
          return;
        }
      } else {
        const res = await fetch("/api/character/relocate-with-corp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetStateId,
            ...(targetCountryId ? { targetCountryId } : {}),
            paymentMethod: mode === "imperial-combined" ? "imperial-free" : payment,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Relocation failed");
          return;
        }
      }
      resetConfirmState();
      // Re-fetch auth nav so CurrencyContext picks up the new characterCountryId
      // before navigation. Without this, client components show the old currency
      // (e.g. EUR after DE→US relocation) until a hard refresh.
      await refetch(true);
      router.refresh();
      router.push(redirectPath);
    } catch {
      setError("Relocation failed");
    } finally {
      setLoading(false);
    }
  }

  if (!showButton) return null;

  const hasPlayerCeoCorp = !!corp && !corp.isImperialCeo;
  const hasImperialCeoCorp = !!corp && corp.isImperialCeo;
  const hasCeoCorp = hasPlayerCeoCorp || hasImperialCeoCorp;
  const choosingMoveCorp = corpChoice === "move";
  const choosingAbandonCorp = corpChoice === "abandon";

  const moveCorpDisabledReason =
    payment === "bond" && bondCooldownTurns !== null
      ? `Bond cooldown: ${bondCooldownTurns} turns remaining`
      : payment === "cash" && !canPayCash
        ? "Insufficient Liquid Capital"
        : payment === "bond" && !canIssueBond
          ? "Bond leverage limit exceeded"
          : undefined;

  return (
    <div className="relative">
      <Button
        variant="secondary"
        onClick={() => {
          setError(null);
          setPayment("cash");
          setCorpChoice(null);
          setConfirming(true);
        }}
        disabled={disabled}
        title={tooltip}
        className="h-9 min-w-0 shrink-0 border-card-border/80 bg-card/80 text-foreground shadow-panel backdrop-blur-sm hover:bg-card-elevated"
      >
        Relocate here
      </Button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !loading && resetConfirmState()}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-card-border bg-card p-6 shadow-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Relocate to another state"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground">Relocate to {targetName}?</h3>

            <div className="mt-3 space-y-2 text-sm text-muted">
              <p className="font-semibold text-foreground">The following will happen:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Political influence resets to 0.</li>
                <li>Donor base resets to 0.</li>
                <li>Group favorability is cleared.</li>
                <li>
                  State/region-party leadership positions (chair, vice-chair, treasurer) in your
                  current state are vacated.
                </li>
                {isCountryChange && (
                  <>
                    <li className="text-warning">
                      National influence and party influence reset to 0 (country change).
                    </li>
                    <li className="text-warning">
                      You will leave your party and become independent (country change).
                    </li>
                    <li className="text-warning">
                      National party leadership positions and committee memberships are vacated
                      (country change).
                    </li>
                    <li className="text-warning">
                      If you are a central-bank chair, you will resign the post.
                    </li>
                  </>
                )}
                {totalCandidacies > 0 && (
                  <li>
                    You will be withdrawn from {totalCandidacies} active candidac
                    {totalCandidacies === 1 ? "y" : "ies"}
                    {candidacyBreakdown.length > 0 && <> ({candidacyBreakdown.join(", ")})</>}.
                  </li>
                )}
                {status!.hasOffice && (
                  <li className="text-error">
                    You will automatically resign from your current office.
                  </li>
                )}
                {hasImperialCeoCorp && choosingMoveCorp && (
                  <li className="text-warning">
                    {corp!.corpName} will relocate with you at no cost.
                  </li>
                )}
              </ul>
              <p className="pt-2 text-xs">
                Campaign funds, personal cash, savings, actions, policies, and career history are
                preserved.
              </p>
            </div>

            {hasCeoCorp && (
              <div className="mt-4 space-y-3 rounded-lg border border-card-border bg-background/50 p-4 text-sm">
                <div>
                  <p className="font-semibold text-foreground">
                    Your Corporation - {corp!.corpName}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    What do you want to do with your corporation when you relocate?
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCorpChoice("move");
                      setError(null);
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      choosingMoveCorp
                        ? "border-primary bg-primary/10"
                        : "border-card-border bg-card-muted hover:border-primary/40"
                    }`}
                  >
                    <p className="font-medium text-foreground">Move Corp</p>
                    <p className="mt-1 text-xs text-muted">
                      Relocate your character and headquarters together so the CEO role stays with
                      you.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCorpChoice("abandon");
                      setError(null);
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      choosingAbandonCorp
                        ? "border-error/40 bg-error/10"
                        : "border-card-border bg-card-muted hover:border-error/40"
                    }`}
                  >
                    <p className="font-medium text-foreground">Abandon Corp</p>
                    <p className="mt-1 text-xs text-muted">
                      Relocate without moving headquarters. This will vacate your CEO role.
                    </p>
                  </button>
                </div>

                {choosingMoveCorp && hasPlayerCeoCorp && (
                  <div className="rounded-lg border border-card-border bg-card-muted/60 p-3 text-sm">
                    <p className="mb-1 font-semibold text-foreground">
                      Move {corp!.corpName} with you
                    </p>
                    <p className="text-xs text-muted">
                      Current HQ: <strong>{corp!.currentHqState}</strong> -&gt; {targetName}.
                    </p>
                    <p className="text-xs text-muted">
                      Cost: <strong>{formatAmount(corpCost)}</strong>
                      {corpCrossCountry && (
                        <span className="ml-2 inline-block rounded bg-warning/20 px-2 py-0.5 text-[10px] font-medium text-warning">
                          2x cross-country
                        </span>
                      )}
                    </p>
                    <div className="mt-2 flex gap-3">
                      <label className="flex-1 cursor-pointer items-center gap-2 rounded-lg border border-card-border px-3 py-2 hover:border-primary/40 sm:flex">
                        <input
                          type="radio"
                          name="corpPayment"
                          checked={payment === "cash"}
                          onChange={() => setPayment("cash")}
                        />
                        <div className="text-xs">
                          <div className="font-medium text-foreground">Liquid Capital</div>
                          <div className="text-muted">
                            {formatAmount(corp!.liquidCapitalAnchor)} available
                            {!canPayCash && <span className="ml-1 text-error">(insufficient)</span>}
                          </div>
                        </div>
                      </label>
                      <label className="flex-1 cursor-pointer items-center gap-2 rounded-lg border border-card-border px-3 py-2 hover:border-primary/40 sm:flex">
                        <input
                          type="radio"
                          name="corpPayment"
                          checked={payment === "bond"}
                          onChange={() => setPayment("bond")}
                        />
                        <div className="text-xs">
                          <div className="font-medium text-foreground">Bond issuance</div>
                          <div className="text-muted">
                            {bondCooldownTurns !== null
                              ? `Cooldown: ${bondCooldownTurns} turns`
                              : !canIssueBond
                                ? "Leverage limit reached"
                                : "7-year bond at market rate"}
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {choosingMoveCorp && hasImperialCeoCorp && (
                  <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
                    <p className="font-semibold text-foreground">Move {corp!.corpName} with you</p>
                    <p className="mt-1 text-xs text-muted">
                      Your corporation will relocate from <strong>{corp!.currentHqState}</strong> to{" "}
                      <strong>{targetName}</strong> with no relocation cost.
                    </p>
                  </div>
                )}

                {choosingAbandonCorp && (
                  <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm">
                    <p className="font-semibold text-foreground">Abandon {corp!.corpName}</p>
                    <p className="mt-1 text-xs text-muted">
                      You will relocate without moving the corporation, and you will be removed as
                      CEO as part of the relocation.
                    </p>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-2 text-sm text-error">
                {error}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={resetConfirmState} disabled={loading}>
                Cancel
              </Button>
              {hasCeoCorp ? (
                choosingMoveCorp ? (
                  <Button
                    variant="primary"
                    onClick={() => submit(hasImperialCeoCorp ? "imperial-combined" : "combined")}
                    disabled={loading || (hasPlayerCeoCorp && !canMoveCorp)}
                    title={hasPlayerCeoCorp ? moveCorpDisabledReason : undefined}
                  >
                    {loading ? "Relocating..." : "Relocate & Move Corporation"}
                  </Button>
                ) : choosingAbandonCorp ? (
                  <Button
                    variant="destructive"
                    onClick={() => submit("character-only")}
                    disabled={loading}
                  >
                    {loading ? "Relocating..." : "Relocate & Abandon Corporation"}
                  </Button>
                ) : (
                  <p className="self-center text-xs text-muted">
                    Choose whether to move or abandon your corporation to continue.
                  </p>
                )
              ) : (
                <Button
                  variant="primary"
                  onClick={() => submit("character-only")}
                  disabled={loading}
                >
                  {loading ? "Relocating..." : "Relocate"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
