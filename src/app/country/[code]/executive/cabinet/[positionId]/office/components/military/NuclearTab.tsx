"use client";

import { useEffect, useState } from "react";
import type { NuclearNode, NuclearNodeStatus } from "@/lib/military/nuclearProgram";
import { NUCLEAR_ENTRY_DOCTRINE_NODE } from "@/lib/military/nuclearProgram";
import { AggTile, fmtMoneyAbs } from "./militaryUi";

/** The GET nuclear route's payload, as the flagship fetches it. */
export interface NuclearStatusView {
  program: {
    adopted: Record<string, number>;
    warheads: number;
    productionRate: number;
    lastTestTurn: number | null;
  };
  nodes: Array<NuclearNode & { status: NuclearNodeStatus }>;
  productionCap: number;
  warheadUnitCost: number;
  deterrence: number;
  eligibility: {
    capable: boolean;
    coldWarEnabled: boolean;
    doctrineAdopted: boolean;
    eligible: boolean;
  };
  year: number | null;
}

const STATUS_LABEL: Record<NuclearNodeStatus, string> = {
  adopted: "Adopted",
  available: "Available",
  locked: "Locked",
  future: "Future",
};

const STATUS_DOT: Record<NuclearNodeStatus, string> = {
  adopted: "var(--success, #4ea87a)",
  available: "var(--gov)",
  locked: "#4a4a58",
  future: "#3a3a48",
};

/** One entry gate in the locked-programme explainer. */
function Gate({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: met ? "var(--success, #4ea87a)" : "#4a4a58" }}
      />
      <span className={met ? "text-foreground" : "text-muted"}>{label}</span>
    </div>
  );
}

/**
 * The nuclear programme: the device ladder climbed by testing, the delivery
 * legs adopted quietly, and the standing production order. Presentational;
 * fetching and mutations live in MilitaryFlagship, like the arsenal.
 */
export function NuclearTab({
  status,
  currencySymbol,
  canAct,
  busy,
  onConductTest,
  onAdoptDelivery,
  onSetProduction,
}: {
  /** Undefined while the flagship's fetch is still in flight. */
  status?: NuclearStatusView;
  currencySymbol: string;
  canAct: boolean;
  busy: boolean;
  onConductTest: (nodeKey: string) => Promise<boolean>;
  onAdoptDelivery: (nodeKey: string) => Promise<boolean>;
  onSetProduction: (rate: number) => Promise<boolean>;
}) {
  // Testing is a world event that cannot be taken back, so it takes two clicks.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState<string>("");

  const orderedRate = status?.program.productionRate ?? 0;
  // Re-seed the rate field when the server's standing order changes.
  useEffect(() => {
    setRateInput(String(orderedRate));
  }, [orderedRate]);

  if (!status) {
    return (
      <div className="rounded-xl border border-card-border bg-card px-4 py-6 text-center text-[13px] text-muted">
        Loading the nuclear programme...
      </div>
    );
  }

  const { program, nodes, eligibility } = status;

  if (!eligibility.eligible) {
    return (
      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Nuclear programme</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            This programme is closed. Three gates open it; every one must be met.
          </p>
        </div>
        <div className="space-y-2 px-4 py-3">
          <Gate
            met={eligibility.capable}
            label="A nation with the industrial and scientific base for a bomb"
          />
          <Gate
            met={eligibility.doctrineAdopted}
            label={`The "${NUCLEAR_ENTRY_DOCTRINE_NODE}" doctrine node adopted`}
          />
          <Gate met={eligibility.coldWarEnabled} label="The Cold War subsystem active" />
        </div>
      </div>
    );
  }

  const devices = nodes.filter((n) => n.kind === "device");
  const legs = nodes.filter((n) => n.kind === "delivery");
  const rateWanted = Number(rateInput);
  const rateValid =
    Number.isInteger(rateWanted) && rateWanted >= 0 && rateWanted <= status.productionCap;

  const nodeCard = (node: NuclearNode & { status: NuclearNodeStatus }) => {
    const actionable = canAct && node.status === "available" && !busy;
    return (
      <div
        key={node.key}
        className={`rounded-lg border px-3 py-2.5 ${
          node.status === "adopted"
            ? "border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color-mix(in_srgb,var(--success)_6%,transparent)]"
            : node.status === "available"
              ? "border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_6%,transparent)]"
              : "border-card-border"
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: STATUS_DOT[node.status] }}
          />
          <span
            className={`text-[13px] font-semibold ${
              node.status === "locked" || node.status === "future"
                ? "text-muted"
                : "text-foreground"
            }`}
          >
            {node.name}
          </span>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-muted">
            {node.status === "future" ? `From ${node.yearAvailable}` : STATUS_LABEL[node.status]}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">{node.desc}</p>
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
          <span className="tabular">
            {fmtMoneyAbs(currencySymbol, node.cost)}
            {node.kind === "device" ? " test" : ""}
          </span>
          {node.kind === "device" && node.productionCap != null && (
            <span className="tabular">{node.productionCap} warheads/turn</span>
          )}
          {node.status === "available" &&
            node.kind === "device" &&
            canAct &&
            (confirming === node.key ? (
              <button
                disabled={busy}
                onClick={() => {
                  setConfirming(null);
                  void onConductTest(node.key);
                }}
                className="ml-auto rounded-lg border border-[color-mix(in_srgb,var(--error)_40%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--error)] disabled:opacity-50"
              >
                Confirm test
              </button>
            ) : (
              <button
                disabled={!actionable}
                onClick={() => setConfirming(node.key)}
                className="ml-auto rounded-lg border border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-gov-soft disabled:opacity-50"
              >
                Conduct test
              </button>
            ))}
          {node.status === "available" && node.kind === "delivery" && canAct && (
            <button
              disabled={!actionable}
              onClick={() => void onAdoptDelivery(node.key)}
              className="ml-auto rounded-lg border border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-gov-soft disabled:opacity-50"
            >
              Adopt
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <AggTile
          label="Warheads in stockpile"
          value={program.warheads.toLocaleString("en-US")}
          tone="gov"
        />
        <AggTile
          label="Deterrence credibility"
          value={`${status.deterrence} / 100`}
          tone={status.deterrence > 0 ? undefined : "warning"}
          ring={status.deterrence}
        />
        <AggTile
          label="Production order"
          value={`${program.productionRate} / ${status.productionCap} per turn`}
        />
      </div>

      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Warhead production</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            A standing order the complex fills each turn out of the defence appropriation. A rate
            the budget cannot cover simply builds less; nothing is bought here.
          </p>
        </div>
        <div className="space-y-2 px-4 py-3">
          {status.productionCap <= 0 ? (
            <p className="text-[13px] text-muted">
              No device has been proven. Conduct a test before ordering production.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <label
                  htmlFor="nuclear-rate"
                  className="text-[11px] font-bold uppercase tracking-wider text-muted"
                >
                  Warheads per turn
                </label>
                <input
                  id="nuclear-rate"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={status.productionCap}
                  step={1}
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  disabled={busy || !canAct}
                  className="tabular w-24 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-50"
                />
                <button
                  disabled={busy || !canAct || !rateValid || rateWanted === program.productionRate}
                  onClick={() => void onSetProduction(rateWanted)}
                  className="rounded-lg border border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] px-3 py-2 text-[12px] font-semibold text-gov-soft disabled:opacity-50"
                >
                  Set rate
                </button>
              </div>
              <p className="text-[11px] text-muted">
                {fmtMoneyAbs(currencySymbol, status.warheadUnitCost)} per warhead at the current
                device tier, up to {status.productionCap} per turn.
                {!rateValid && rateInput !== "" && (
                  <span className="text-[var(--error)]">
                    {" "}
                    Order a whole number between 0 and {status.productionCap}.
                  </span>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-card-border bg-card">
          <div className="border-b border-card-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground">Device ladder</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              Each device is proven only by a test - a world event every capital sees.
            </p>
          </div>
          <div className="space-y-2 px-4 py-3">{devices.map(nodeCard)}</div>
        </div>
        <div className="rounded-xl border border-card-border bg-card">
          <div className="border-b border-card-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground">Delivery legs</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              Adopted quietly, doctrine-style. A stockpile with no way to deliver it deters nobody.
            </p>
          </div>
          <div className="space-y-2 px-4 py-3">{legs.map(nodeCard)}</div>
        </div>
      </div>
    </div>
  );
}
