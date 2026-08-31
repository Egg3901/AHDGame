"use client";

import { useMemo, useState } from "react";
import { Modal, Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { AlertTriangle, Info, TrendingUp } from "lucide-react";
import type { PlantsData } from "../types";
import { fmtUnits, fmtMult, fmtPct } from "../lib/plants";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  capitalizeFacility,
  facilityPlural,
  facilitySingular,
  facilityVocabulary,
} from "@/lib/constants/facilityVocabulary";
import { facilitiesFromUnits, plantSizeUnits } from "@/lib/constants/facilityQuantum";

interface BuildCapacityDialogProps {
  open: boolean;
  onClose: () => void;
  plants: PlantsData;
  /** Drives the facility noun throughout the dialog. */
  sectorType: CorporationType;
  sectorLabel: string;
  submitting: boolean;
  /** Server-side error text from the last attempt, or empty. */
  errorMessage: string;
  onSubmit: (units: number) => void;
}

/** Nobody builds this many at once; the cap only stops a stray paste locking the dialog. */
const MAX_FACILITIES = 1_000_000;

/**
 * Desktop accelerators for the +/- buttons and the arrow keys. Holding a
 * modifier multiplies whatever step the control already walks, so shift on the
 * +10 button moves 100 and ctrl moves 1000. Touch users get the same reach from
 * the +10/-10 buttons and from typing the number straight in.
 */
function stepMultiplier(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): number {
  const coarse = e.ctrlKey || e.metaKey;
  if (coarse && e.shiftKey) return 1000;
  if (coarse) return 100;
  if (e.shiftKey) return 10;
  return 1;
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_FACILITIES, Math.floor(n));
}

/**
 * The build dialog: the one place a player turns money into productive capacity.
 *
 * Design intent — this is the hero of the plants feature, so it answers four
 * questions in order, top to bottom, with no scrolling back:
 *
 *   1. how much am I buying   (stepper, in whole facilities; one facility = plantSizeUnits(type) units/day)
 *   2. what does it cost      (itemized, every price leg named)
 *   3. when does it pay back  (live, at today's fill rate and margin)
 *   4. should I               (demand check against untapped market headroom)
 *
 * Cost is exactly linear in units, so the whole preview is computed on the
 * client from the per-unit quote the page payload already carries. No round
 * trip per keystroke, and it is the same `computeBuildCost` the server charges.
 */
export default function BuildCapacityDialog({
  open,
  onClose,
  plants,
  sectorType,
  sectorLabel,
  submitting,
  errorMessage,
  onSubmit,
}: BuildCapacityDialogProps) {
  const { formatAmount } = useCurrency();
  const workersDesired = plants.workersDesired ?? plants.workers;
  const labourStaffingFactor =
    plants.labourStaffingFactor ??
    (workersDesired > 0 ? Math.min(1, plants.workers / workersDesired) : 1);
  // The dialog counts FACILITIES (the multi-build lever); the API stays in
  // units. One facility = plantSizeUnits(type) units — see facilityQuantum.ts
  // for why a "power station" is not one ₳92/day unit.
  const [count, setCount] = useState(1);
  // Raw text while the field is focused. Without it, clamping on every keystroke
  // means the field can never be empty, so a player cannot clear "1" and type
  // "250" - the leading digit keeps getting eaten.
  const [countDraft, setCountDraft] = useState<string | null>(null);

  /** Set the count from a control (not from typing) and drop any in-flight draft. */
  function commitCount(next: number) {
    setCount(clampCount(next));
    setCountDraft(null);
  }

  /** Move by `base`, multiplied by whichever modifier keys are held. */
  function nudge(base: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    const delta = base * stepMultiplier(e);
    setCount((c) => clampCount(c + delta));
    setCountDraft(null);
  }

  const vocab = facilityVocabulary(sectorType);
  const site = facilitySingular(sectorType);
  const sites = facilityPlural(sectorType);
  const unitsPerFacility = plantSizeUnits(sectorType);
  const q = plants.buildQuote;
  const money = (anchor: number) => formatAmount(anchor);

  const preview = useMemo(() => {
    const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    const safeUnits = safeCount * unitsPerFacility;
    // C9: the server charges construction cost PLUS the cross-currency transfer
    // fee (`corpToSectorCountrySpread`). Quoting only `perUnitAnchor × units`
    // under-quoted every foreign build, and the affordability gate let the
    // player submit an order the server then refused for insufficient capital.
    const construction = q.perUnitAnchor * safeUnits;
    const transferFee = construction * (q.fxSpreadRate ?? 0);
    const total = construction + transferFee;
    const workersNeeded = plants.laborIntensity * safeUnits;
    // Payback: a unit's daily profit does not depend on how many you order, so
    // the payback period is the same at any order size. Priced at TODAY's
    // per-unit profit and today's fill rate, which is the honest estimate a
    // player can act on.
    const fill = plants.fillRate ?? 1;
    const perUnitDailyProfit = (plants.pnl.profitPerUnitAnchor ?? 0) * fill;
    // Payback is measured against what the player actually pays, fee included.
    const paybackDays = perUnitDailyProfit > 0 ? q.perUnitChargedAnchor / perUnitDailyProfit : null;
    // Buyers' room is the BINDING constraint: unmet demand for this sector's
    // outputs (demandGapUnits), never the unowned pool alone — the pool is
    // claimable market share and reads huge even in a glut where extra units
    // simply go unsold (ticket #1027 follow-up).
    const overHeadroom = safeUnits > Math.min(plants.headroomUnits, plants.demandGapUnits ?? 0);
    return {
      safeCount,
      safeUnits,
      construction,
      transferFee,
      total,
      workersNeeded,
      paybackDays,
      perUnitDailyProfit,
      overHeadroom,
      affordable: total <= q.corpCapitalAnchor,
    };
  }, [count, unitsPerFacility, q, plants]);

  const maxAffordableFacilities = Math.floor(q.maxAffordableUnits / unitsPerFacility);
  const ownedFacilities =
    plants.plantCount ?? facilitiesFromUnits(sectorType, plants.capacityUnits ?? 0);
  const buyersRoomUnits = Math.min(plants.headroomUnits, plants.demandGapUnits ?? 0);
  const headroomFacilities = Math.floor(buyersRoomUnits / unitsPerFacility);
  // Which constraint actually bound, when there is no room at all. A market
  // whose SHARE is fully claimed is a different situation from one where
  // buyers have no unmet demand, and the player can act on the difference.
  const noShareLeft = plants.headroomUnits < 1;
  const blockedByMothball = plants.mothballed;
  const canSubmit =
    !submitting && !blockedByMothball && preview.safeCount > 0 && preview.affordable;

  return (
    <Modal
      open={open}
      onClose={onClose}
      scrollable
      maxWidthClass="max-w-lg"
      title={
        <div>
          <p className="text-heading-sm font-bold text-foreground">
            {vocab.buildVerb === "open" ? "Open more capacity" : "Build capacity"}
          </p>
          <p className="mt-0.5 text-body-sm font-normal text-muted">
            {sectorLabel} · comes online in {plants.buildTurns} turns
          </p>
        </div>
      }
    >
      <div className="space-y-5">
        {blockedByMothball && (
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p className="text-body-sm text-foreground">
              {capitalizeFacility(sites)} here are mothballed. Turn them back on before you add
              more. New capacity would sit cold too.
            </p>
          </div>
        )}

        {/* 1. HOW MUCH ─────────────────────────────────────────────────────── */}
        <div>
          <label
            htmlFor="build-count"
            className="text-body-xs font-semibold uppercase tracking-wider text-muted"
          >
            {capitalizeFacility(sites)} to {vocab.buildVerb}
          </label>
          <div className="mt-2 flex items-center gap-2">
            <StepButton
              label={`${vocab.buildVerb} 10 fewer ${sites}`}
              disabled={count <= 1}
              onClick={(e) => nudge(-10, e)}
              wide
            >
              −10
            </StepButton>
            <StepButton
              label={`${vocab.buildVerb} one fewer ${site}`}
              disabled={count <= 1}
              onClick={(e) => nudge(-1, e)}
            >
              −
            </StepButton>
            <div className="min-w-0 flex-1 rounded-lg border border-card-border bg-background px-3 py-2 text-center">
              <input
                id="build-count"
                // Text, not number: the spinners and the scroll wheel nudge a
                // large order by accident, and `type="number"` refuses to report
                // a half-typed value.
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={countDraft ?? String(count)}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 7);
                  setCountDraft(digits);
                  // An empty field reads as zero, so the cost preview and the
                  // build button go quiet instead of quoting a stale number.
                  setCount(digits === "" ? 0 : clampCount(Number(digits)));
                }}
                onBlur={() => {
                  setCountDraft(null);
                  if (count < 1) setCount(1);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    nudge(1, e);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    nudge(-1, e);
                  } else if (e.key === "PageUp") {
                    e.preventDefault();
                    nudge(10, e);
                  } else if (e.key === "PageDown") {
                    e.preventDefault();
                    nudge(-10, e);
                  }
                }}
                aria-describedby="build-count-help"
                className="w-full bg-transparent text-center text-heading font-bold tabular-nums text-foreground focus:outline-none"
              />
              <p className="text-body-xs text-muted">
                {count === 1 ? site : sites} · {fmtUnits(unitsPerFacility)} units/day each
              </p>
            </div>
            <StepButton label={`${vocab.buildVerb} one more ${site}`} onClick={(e) => nudge(1, e)}>
              +
            </StepButton>
            <StepButton
              label={`${vocab.buildVerb} 10 more ${sites}`}
              onClick={(e) => nudge(10, e)}
              wide
            >
              +10
            </StepButton>
          </div>
          <p id="build-count-help" className="mt-2 text-body-xs text-muted">
            Type a number, or hold <kbd className="font-semibold">Shift</kbd> for ten times the step
            and <kbd className="font-semibold">Ctrl</kbd> for a hundred times.
          </p>
          <p className="mt-1 text-body-xs text-muted">
            You hold {fmtUnits(ownedFacilities)} {ownedFacilities === 1 ? site : sites} today (
            {fmtUnits(plants.capacityUnits)} units/day). Most you can afford right now:{" "}
            <button
              type="button"
              onClick={() => commitCount(Math.max(1, maxAffordableFacilities))}
              className="font-semibold text-primary underline decoration-dotted underline-offset-2"
            >
              {fmtUnits(maxAffordableFacilities)}
            </button>
            .
          </p>
        </div>

        {/* 2. WHAT IT COSTS ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-card-border bg-card-muted/60 p-4">
          <p className="mb-3 text-body-xs font-semibold uppercase tracking-wider text-muted">
            What it costs
          </p>
          <dl className="space-y-1.5 text-body-sm">
            <CostLeg
              label={`Base price per ${site}`}
              value={money(q.unitPriceAnchor * unitsPerFacility)}
              help={`The standing price of one ${site} (${fmtUnits(unitsPerFacility)} units/day of capacity) in this industry, at this point in history.`}
            />
            <CostLeg
              label="Your market share"
              value={fmtMult(q.dominanceMultiplier)}
              help="Growing a sector you already dominate costs more. Sites, staff and permits get harder to come by."
              muted={q.dominanceMultiplier === 1}
            />
            <CostLeg
              label="Borrowing rates"
              value={fmtMult(q.rateMultiplier)}
              help="Building is financed. When the country's prime rate is high, building costs more."
              muted={q.rateMultiplier === 1}
            />
            <CostLeg
              label="CEO business sense"
              value={fmtMult(q.acumenMultiplier)}
              help="A sharper CEO negotiates a better build price and is less exposed to rates."
              muted={q.acumenMultiplier === 1}
            />
            <CostLeg
              label="Local prices"
              value={fmtMult(q.hostPriceMultiplier)}
              help={`Where you build changes what it costs. An expensive region charges more for the same ${site}.`}
              muted={q.hostPriceMultiplier === 1}
            />
            <CostLeg
              label="Your technology"
              value={fmtMult(q.techMultiplier)}
              help="Unlocked technology lowers what you pay to build."
              muted={q.techMultiplier === 1}
            />
            <div className="flex items-center justify-between border-t border-card-border pt-2">
              <dt className="text-body-sm text-muted">Price per {site}</dt>
              <dd className="text-body-sm font-semibold tabular-nums text-foreground">
                {money(q.perUnitAnchor * unitsPerFacility)}
              </dd>
            </div>
            {preview.transferFee > 0 && (
              <CostLeg
                label="Foreign transfer fee"
                value={money(preview.transferFee)}
                help="This sector is in a country that uses a different currency. Moving the money there costs a small fee on top of the build."
              />
            )}
            <div className="flex items-baseline justify-between pt-1">
              <dt className="text-body font-semibold text-foreground">
                Total for {fmtUnits(preview.safeCount)} {preview.safeCount === 1 ? site : sites}
              </dt>
              <dd
                className={`text-heading-sm font-bold tabular-nums ${
                  preview.affordable ? "text-foreground" : "text-error"
                }`}
              >
                {money(preview.total)}
              </dd>
            </div>
          </dl>
          {!preview.affordable && (
            <p className="mt-2 flex gap-2 rounded-md border border-error/30 bg-error/10 p-2 text-body-sm text-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                You do not have enough money. You hold {money(q.corpCapitalAnchor)}.{" "}
                {maxAffordableFacilities > 0
                  ? `${capitalizeFacility(vocab.buildVerb)} ${fmtUnits(maxAffordableFacilities)} ${
                      maxAffordableFacilities === 1 ? site : sites
                    } or fewer.`
                  : `You cannot afford a ${site} here right now.`}
              </span>
            </p>
          )}
        </div>

        {/* 3. WHAT IT GIVES YOU ────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2">
          <Tile
            label="Ready in"
            value={`${plants.buildTurns}`}
            unit="turns"
            help="Turns until this capacity starts making things. You pay today."
          />
          <Tile
            label="Staff needed"
            value={fmtUnits(preview.workersNeeded)}
            unit="workers"
            help="Extra workers this capacity needs once it is running. Their wages become part of your daily cost."
          />
          <Tile
            label="Pays back in"
            value={preview.paybackDays == null ? "—" : preview.paybackDays.toFixed(0)}
            unit="fin. days"
            tone={
              preview.paybackDays == null
                ? "muted"
                : preview.paybackDays <= 60
                  ? "success"
                  : "warning"
            }
            help={
              preview.paybackDays == null
                ? `This sector is not making a profit per unit today, so a new ${site} would not pay for itself yet.`
                : "How long this build takes to earn back its price, at today's profit per unit and today's share that sells. One game year is 2 financial days."
            }
          />
        </div>

        {workersDesired > 0 && plants.workers < workersDesired && (
          <p className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-body-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              This sector currently fills {fmtPct(labourStaffingFactor)} of its jobs. Building this
              adds {fmtUnits(preview.workersNeeded)} wanted workers, but those jobs may remain
              vacant unless you raise pay or the local workforce grows.
            </span>
          </p>
        )}

        {/* 4. SHOULD YOU ───────────────────────────────────────────────────── */}
        <div
          className={`flex gap-2 rounded-lg border p-3 ${
            preview.overHeadroom ? "border-warning/30 bg-warning/10" : "border-info/30 bg-info/10"
          }`}
        >
          {preview.overHeadroom ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          ) : (
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          )}
          <p className="text-body-sm text-foreground">
            {sectorType === "logistics" ? (
              <>
                Freight demand is the state&apos;s combined bulk and special cargo load. Both draw
                from one shared fleet, and special cargo uses three times as much TEU per unit.
                Check this state&apos;s combined load in the Logistics map before expanding.
              </>
            ) : preview.overHeadroom ? (
              buyersRoomUnits >= 1 ? (
                <>
                  Buyers here have room for about{" "}
                  {headroomFacilities >= 1
                    ? `${fmtUnits(headroomFacilities)} more ${headroomFacilities === 1 ? site : sites}`
                    : `less than one ${site}`}{" "}
                  ({fmtUnits(buyersRoomUnits)} units a day). You are ordering{" "}
                  {fmtUnits(preview.safeCount)}. Expect the extra output to go unsold, or to be
                  taken from a rival.
                </>
              ) : noShareLeft ? (
                // Two very different reasons the room is zero, and saying
                // "oversupplied" for both is what made a fully-claimed market
                // read as a broken one (ticket #1162).
                <>
                  Every unit of this market is already owned, here and by rivals. There is nothing
                  left to claim, so growth has to come from taking share on price rather than from
                  building.
                </>
              ) : (
                <>
                  The market for what this sector makes is oversupplied — buyers are already taking
                  all they need. Unclaimed share can still read above zero, because that counts
                  market nobody has built into rather than buyers waiting. Expect extra output to go
                  unsold unless you win share from a rival on price.
                </>
              )
            ) : (
              <>
                Buyers here have room for about {fmtUnits(headroomFacilities)} more{" "}
                {headroomFacilities === 1 ? site : sites} ({fmtUnits(buyersRoomUnits)} units a day).
                This order fits inside that.
              </>
            )}
          </p>
        </div>

        {errorMessage && (
          <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-body-sm text-error">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onSubmit(preview.safeUnits)}
            disabled={!canSubmit}
            isLoading={submitting}
          >
            {capitalizeFacility(vocab.buildVerb)} {fmtUnits(preview.safeCount)}{" "}
            {preview.safeCount === 1 ? site : sites}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One step control. Passes the click event up so the caller can read the
 * modifier keys off it; that is the whole shift/ctrl accelerator.
 */
function StepButton({
  label,
  onClick,
  disabled = false,
  wide = false,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-10 shrink-0 items-center justify-center rounded-lg border border-card-border bg-background font-bold text-foreground transition-colors hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40 ${
        wide ? "w-12 text-body-sm" : "w-10 text-body-lg"
      }`}
    >
      {children}
    </button>
  );
}

function CostLeg({
  label,
  value,
  help,
  muted = false,
}: {
  label: string;
  value: string;
  help: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt
        className={`flex min-w-0 items-center gap-1 text-body-sm ${muted ? "text-muted" : "text-foreground"}`}
      >
        <span className="truncate">{label}</span>
        <span title={help} className="shrink-0">
          <Info className="h-3 w-3 text-muted" aria-label={help} />
        </span>
      </dt>
      <dd
        className={`shrink-0 text-body-sm tabular-nums ${muted ? "text-muted" : "text-foreground"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  help,
  tone = "default",
}: {
  label: string;
  value: string;
  unit: string;
  help: string;
  tone?: "default" | "success" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "muted"
          ? "text-muted"
          : "text-foreground";
  // Column layout with the value pushed to the bottom: the three labels wrap to
  // different line counts ("Staff needed" and "Pays back in" wrap where "Ready
  // in" does not, and all three wrap at 375px), and without this the numbers
  // sat at three different heights across the row.
  return (
    <div
      className="flex h-full flex-col rounded-lg border border-card-border bg-background/40 p-3"
      title={help}
    >
      <p className="text-body-xs uppercase leading-tight tracking-wider text-muted">{label}</p>
      <p className={`mt-auto pt-0.5 text-body-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-body-xs text-muted">{unit}</p>
    </div>
  );
}
