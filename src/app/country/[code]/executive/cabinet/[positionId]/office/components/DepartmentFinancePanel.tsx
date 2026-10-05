"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { Slider } from "@/components/ui/Slider";
import type { DepartmentFinanceReadModel } from "@/lib/governmentFinance/readModel";
import {
  departmentFundingPreview,
  programFundingRequestPerTurn,
} from "@/lib/resetFinance/rules/programRequest";
import { DepartmentProgramPanel } from "./DepartmentProgramPanel";

function money(value: number, symbol: string): string {
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

function signedMoney(value: number, symbol: string): string {
  return value < 0 ? `-${money(Math.abs(value), symbol)}` : money(value, symbol);
}

export function DepartmentFinancePanel({
  department,
  currencySymbol,
  canAct = false,
  countryCode,
  positionId,
  currentTurn,
  onUpdate,
}: {
  department: DepartmentFinanceReadModel;
  currencySymbol: string;
  canAct?: boolean;
  countryCode?: string;
  positionId?: string;
  currentTurn?: number;
  onUpdate?: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const allocatablePrograms = useMemo(
    () =>
      department.programs.filter(
        (program) =>
          program.enabled &&
          program.programId &&
          (program.status === "authorized" || program.status === "operating")
      ),
    [department.programs]
  );
  const defaultShare = allocatablePrograms.length > 0 ? 100 / allocatablePrograms.length : 0;
  const adjustablePrograms = useMemo(
    () =>
      allocatablePrograms.filter(
        (program) => !program.fundingControl || program.fundingControl === "adjustable"
      ),
    [allocatablePrograms]
  );
  const demandMode = department.allocationMode === "demand";
  const baselineAllocations = Object.fromEntries(
    allocatablePrograms.map((program) => [
      program.programId!,
      program.allocationPercent ?? (demandMode ? 100 : defaultShare),
    ])
  );
  const allocationSourceKey = JSON.stringify([
    department.departmentId,
    department.lastAllocationChangedTurn,
    demandMode,
    ...allocatablePrograms.map((program) => [
      program.programId,
      program.allocationPercent,
      program.fundingControl,
    ]),
  ]);
  const [allocationDraft, setAllocationDraft] = useState<{
    sourceKey: string;
    allocations: Record<string, number>;
  }>(() => ({ sourceKey: allocationSourceKey, allocations: baselineAllocations }));
  const allocations =
    allocationDraft.sourceKey === allocationSourceKey
      ? allocationDraft.allocations
      : baselineAllocations;
  const [saving, setSaving] = useState(false);
  const [requestedProgramTab, setRequestedProgramTab] = useState("overview");
  const programTabListRef = useRef<HTMLDivElement>(null);
  const [programTabOverflow, setProgramTabOverflow] = useState({ left: false, right: false });
  const selectedProgram = allocatablePrograms.find(
    (program) => program.programId === requestedProgramTab
  );
  // A repeal or jurisdiction change removes the program from this list. Fall back
  // during the same render instead of retaining a now-invalid selected tab.
  const activeProgramTab = selectedProgram?.programId ?? "overview";
  const allocationTotal = Object.values(allocations).reduce((sum, value) => sum + value, 0);
  const allocationsValid =
    Object.values(allocations).every(
      (value) =>
        Number.isFinite(value) &&
        value >= 0 &&
        value <= (demandMode ? 200 : 100) &&
        (!demandMode || Number.isSafeInteger(value))
    ) &&
    (demandMode || Math.abs(allocationTotal - 100) <= 0.1);
  const allocationLocked =
    currentTurn !== undefined && department.lastAllocationChangedTurn === currentTurn;
  const previewTurn = Math.max(1, (currentTurn ?? 0) + 1);
  const fundingRequestByProgram = demandMode
    ? Object.fromEntries(
        allocatablePrograms.map((program) => [
          program.programId!,
          program.fundingControl === "no_separate_allocation" || program.annualDemand === undefined
            ? 0
            : programFundingRequestPerTurn(
                program.annualDemand,
                allocations[program.programId!] ?? 100,
                previewTurn
              ),
        ])
      )
    : {};
  const totalFundingRequested = Object.values(fundingRequestByProgram).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const fundingPreview =
    demandMode && department.annualAuthority !== undefined && department.balance !== undefined
      ? departmentFundingPreview({
          annualAuthority: department.annualAuthority,
          balance: department.balance,
          encumbered: department.encumbered ?? 0,
          arrears: department.arrears ?? 0,
          requestedPerTurn: totalFundingRequested,
          turn: previewTurn,
        })
      : undefined;

  useEffect(() => {
    const tabList = programTabListRef.current;
    if (!tabList) return;

    const updateOverflow = () => {
      setProgramTabOverflow({
        left: tabList.scrollLeft > 1,
        right: tabList.scrollLeft + tabList.clientWidth < tabList.scrollWidth - 1,
      });
    };

    // Keep the active tab visible without moving the whole page vertically.
    // HTMLElement.scrollIntoView can make this section appear to vanish after
    // a refresh that restores the user's previous page position.
    const activeTab = tabList.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (activeTab) {
      const tabLeft = activeTab.offsetLeft;
      const tabRight = tabLeft + activeTab.offsetWidth;
      const visibleLeft = tabList.scrollLeft;
      const visibleRight = visibleLeft + tabList.clientWidth;
      if (tabLeft < visibleLeft) {
        tabList.scrollTo({ left: Math.max(0, tabLeft - 12), behavior: "smooth" });
      } else if (tabRight > visibleRight) {
        tabList.scrollTo({
          left: tabRight - tabList.clientWidth + 12,
          behavior: "smooth",
        });
      }
    }
    updateOverflow();
    tabList.addEventListener("scroll", updateOverflow, { passive: true });
    window.addEventListener("resize", updateOverflow);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateOverflow);
    resizeObserver?.observe(tabList);
    tabList
      .querySelectorAll<HTMLElement>('[role="tab"]')
      .forEach((tab) => resizeObserver?.observe(tab));
    return () => {
      tabList.removeEventListener("scroll", updateOverflow);
      window.removeEventListener("resize", updateOverflow);
      resizeObserver?.disconnect();
    };
  }, [activeProgramTab, allocatablePrograms.length]);

  function scrollProgramTabs(direction: "left" | "right") {
    const tabList = programTabListRef.current;
    if (!tabList) return;
    const distance = Math.max(tabList.clientWidth * 0.6, 180);
    tabList.scrollBy({
      left: direction === "left" ? -distance : distance,
      behavior: "smooth",
    });
  }

  function setProgramAllocation(programId: string, value: number) {
    setAllocationDraft({
      sourceKey: allocationSourceKey,
      allocations: { ...allocations, [programId]: value },
    });
  }

  async function saveAllocations() {
    if (!countryCode || !positionId) return;
    if (!allocationsValid) {
      showToast(
        demandMode
          ? "Enter a whole-number request from 0% to 200% for every law family."
          : `Program allocations must total 100%. Current total: ${allocationTotal.toFixed(1)}%.`,
        "error"
      );
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/department-allocation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            departmentId: department.departmentId,
            programAllocationPercents: allocations,
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        showToast(body.error ?? "Failed to update program allocations.", "error");
        return;
      }
      showToast("Department program allocations updated.", "success");
      await onUpdate?.();
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-card-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-body-sm font-medium text-muted">Department account</p>
            <h2 className="text-lg font-semibold">{department.departmentName}</h2>
          </div>
          <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold uppercase">
            {department.kind.replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-3 text-sm text-muted">{department.explanation}</p>
        {department.balance !== undefined && (
          <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-card-border pt-4 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-muted">Annual authority</dt>
              <dd>{money(department.annualAuthority ?? 0, currencySymbol)}</dd>
            </div>
            <div>
              <dt className="text-muted">Account balance</dt>
              <dd>{money(department.balance, currencySymbol)}</dd>
            </div>
            <div>
              <dt className="text-muted">Available</dt>
              <dd>{money(department.availableBalance ?? 0, currencySymbol)}</dd>
            </div>
            <div>
              <dt className="text-muted">Encumbered</dt>
              <dd>{money(department.encumbered ?? 0, currencySymbol)}</dd>
            </div>
            <div>
              <dt className="text-muted">Arrears</dt>
              <dd>{money(department.arrears ?? 0, currencySymbol)}</dd>
            </div>
          </dl>
        )}
        {department.lastAuthorityPaid !== undefined && (
          <div className="mt-4 border-t border-card-border pt-4 text-sm">
            <dl>
              <div>
                <dt
                  className="text-muted"
                  title="Enacted authority credited to this department in the last settled turn, including any catch-up payment."
                >
                  Last appropriation credit
                </dt>
                <dd>{money(department.lastAuthorityPaid ?? 0, currencySymbol)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted">
              Enacted appropriations are credited in full. Any national shortfall is reflected in
              the National Budget; supplier arrears are shown separately above.
            </p>
          </div>
        )}
      </section>

      {allocatablePrograms.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-card-border bg-card">
          <div className="border-b border-card-border bg-card-muted/40 px-3 pt-3">
            <div className="relative">
              {allocatablePrograms.length > 1 && (
                <button
                  type="button"
                  aria-label="Scroll program tabs left"
                  disabled={!programTabOverflow.left}
                  onClick={() => scrollProgramTabs("left")}
                  className="absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-card-border bg-card-elevated p-1.5 text-muted shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gov disabled:cursor-default disabled:opacity-35"
                >
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {programTabOverflow.left && (
                <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-card-muted to-transparent" />
              )}
              <div
                ref={programTabListRef}
                role="tablist"
                aria-label={`${department.departmentName} programs`}
                className={`scrollbar-hide flex gap-1 overflow-x-auto ${
                  allocatablePrograms.length > 1 ? "px-9" : ""
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeProgramTab === "overview"}
                  onClick={() => setRequestedProgramTab("overview")}
                  className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                    activeProgramTab === "overview"
                      ? "border-gov text-foreground"
                      : "border-transparent text-muted hover:text-foreground"
                  }`}
                >
                  Overview
                </button>
                {allocatablePrograms.map((program) => (
                  <button
                    key={program.programId}
                    type="button"
                    role="tab"
                    title={program.programName}
                    aria-selected={activeProgramTab === program.programId}
                    onClick={() => setRequestedProgramTab(program.programId!)}
                    className={`max-w-56 shrink-0 truncate border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                      activeProgramTab === program.programId
                        ? "border-gov text-foreground"
                        : "border-transparent text-muted hover:text-foreground"
                    }`}
                  >
                    {program.programName}
                  </button>
                ))}
              </div>
              {programTabOverflow.right && (
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-card-muted to-transparent" />
              )}
              {allocatablePrograms.length > 1 && (
                <button
                  type="button"
                  aria-label="Scroll program tabs right"
                  disabled={!programTabOverflow.right}
                  onClick={() => scrollProgramTabs("right")}
                  className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-card-border bg-card-elevated p-1.5 text-muted shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gov disabled:cursor-default disabled:opacity-35"
                >
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {activeProgramTab === "overview" ? (
            <div role="tabpanel" aria-label="Program overview" className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Program allocation</h3>
                  <p className="mt-1 text-sm text-muted">
                    {demandMode
                      ? "Set discretionary services from 0% to 200% of their existing claims. Legal obligations remain at 100%. Requests do not create money; available authority and capacity limit delivery."
                      : "Set the department's emphasis when same-tier program claims exceed available funds. Existing commitments and arrears are paid first."}
                  </p>
                </div>
                <span className={allocationsValid ? "text-sm text-muted" : "text-sm text-error"}>
                  {demandMode ? "Independent requests" : `${allocationTotal.toFixed(1)}%`}
                </span>
              </div>
              {demandMode && (
                <div className="mt-4 rounded-lg border border-card-border bg-card-muted/30 p-4">
                  <h4 className="text-sm font-semibold">What funding levels mean</h4>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Requests are settled each turn. They guide how the department uses paid funds,
                    but do not change the law&apos;s appropriation, create cash, or remove capacity
                    limits.
                  </p>
                  <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="font-semibold text-warning">Below 100%</dt>
                      <dd className="mt-1 leading-relaxed text-muted">
                        Scales back the requested service level. The program&apos;s modeled effects
                        may weaken while more cash remains available to the department.
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-foreground">At 100%</dt>
                      <dd className="mt-1 leading-relaxed text-muted">
                        Requests the service level established by current law. Full delivery still
                        depends on Treasury payment and operating capacity.
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-success">Above 100%</dt>
                      <dd className="mt-1 leading-relaxed text-muted">
                        Requests additional delivery and may draw down the department&apos;s cash
                        buffer. Legal effects cannot exceed full implementation, and an unfunded
                        request can contribute to a shortfall.
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
              {fundingPreview && (
                <div
                  aria-live="polite"
                  className="mt-4 rounded-lg border border-card-border bg-background/35 p-4"
                >
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted">Total funding requested</dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                        {money(totalFundingRequested, currencySymbol)}
                      </dd>
                      <span className="text-xs text-muted">per turn</span>
                    </div>
                    <div>
                      <dt className="text-muted">Department funding remaining</dt>
                      <dd
                        className={`mt-1 text-lg font-semibold tabular-nums ${
                          fundingPreview.allocationRemaining > 0
                            ? "text-success"
                            : fundingPreview.allocationRemaining < 0
                              ? "text-error"
                              : "text-muted"
                        }`}
                      >
                        {signedMoney(fundingPreview.allocationRemaining, currencySymbol)}
                      </dd>
                      <span className="text-xs text-muted">after next-turn requests</span>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-relaxed text-muted">
                    Remaining allocation includes the next enacted appropriation and available
                    department cash after existing encumbrances and arrears.
                  </p>
                </div>
              )}
              <div className="mt-4 space-y-3">
                {allocatablePrograms.map((program) => {
                  const programId = program.programId!;
                  const value = allocations[programId] ?? 0;
                  const sliderId = `department-allocation-${programId}`;
                  const fundingControl = program.fundingControl ?? "adjustable";
                  const allocationIsFixed = fundingControl !== "adjustable";
                  const disabled = !canAct || allocationLocked || saving || allocationIsFixed;
                  const fundingPerTurn =
                    demandMode &&
                    fundingControl !== "no_separate_allocation" &&
                    program.annualDemand !== undefined
                      ? fundingRequestByProgram[programId]
                      : undefined;
                  return (
                    <div
                      key={programId}
                      className="grid items-center gap-3 text-sm sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,2fr)_auto]"
                    >
                      <div>
                        <span className="flex flex-wrap items-center gap-2">
                          <label htmlFor={sliderId}>{program.programName}</label>
                          {fundingControl === "required" && (
                            <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                              Required by law
                            </span>
                          )}
                          {fundingControl === "no_separate_allocation" && (
                            <span className="rounded-full border border-card-border bg-card-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                              No separate allocation
                            </span>
                          )}
                        </span>
                        {fundingPerTurn !== undefined ? (
                          <span className="mt-1 block text-xs tabular-nums text-muted">
                            Funding request per turn: {money(fundingPerTurn, currencySymbol)}
                          </span>
                        ) : fundingControl === "no_separate_allocation" ? (
                          <span className="mt-1 block text-xs text-muted">
                            No separate per-turn funding request
                          </span>
                        ) : null}
                      </div>
                      {fundingControl === "no_separate_allocation" ? (
                        <span className="text-xs text-muted sm:col-span-2">
                          This law has no discretionary Cabinet funding control.
                        </span>
                      ) : (
                        <>
                          <Slider
                            id={sliderId}
                            className="w-full"
                            min={0}
                            max={demandMode ? 200 : 100}
                            step={demandMode ? 1 : 0.1}
                            value={value}
                            disabled={disabled}
                            aria-label={`${program.programName} allocation slider`}
                            onChange={(event) =>
                              setProgramAllocation(programId, Number(event.target.value))
                            }
                          />
                          <span className="flex items-center justify-end gap-2">
                            <input
                              className="ahd-num w-24 rounded-md border border-card-border bg-background px-2 py-1 text-right tabular-nums focus:border-primary focus:outline-none"
                              type="number"
                              min={0}
                              max={demandMode ? 200 : 100}
                              step={demandMode ? 1 : 0.1}
                              value={value}
                              disabled={disabled}
                              aria-label={`${program.programName} allocation percent`}
                              onChange={(event) =>
                                setProgramAllocation(programId, Number(event.target.value))
                              }
                            />
                            <span className="text-muted">%</span>
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {canAct && adjustablePrograms.length > 0 && (
                <button
                  type="button"
                  className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  disabled={allocationLocked || saving || !allocationsValid}
                  onClick={saveAllocations}
                >
                  {allocationLocked
                    ? "Updated this turn"
                    : saving
                      ? "Saving..."
                      : "Save allocation"}
                </button>
              )}
            </div>
          ) : (
            selectedProgram && (
              <DepartmentProgramPanel
                program={selectedProgram}
                currencySymbol={currencySymbol}
                embedded
              />
            )
          )}
        </section>
      )}
    </div>
  );
}
