"use client";

import { useEffect, useCallback } from "react";
import { SubsidiaryCorporationsToggle } from "@/components/admin/economy/SubsidiaryCorporationsToggle";
import {
  useCorporationsAdminState,
  type CorpRow,
  type ImfBailoutPreviewResponse,
  type ConfirmAction,
  type InlinePanel,
} from "./useCorporationsAdminState";
import { CorpSummaryCards } from "./corporations/CorpSummaryCards";
import { CorporationsTable } from "./corporations/CorporationsTable";
import { GlobalConfirmStrip } from "./corporations/GlobalConfirmStrip";
import { SpawnNppPanel } from "./corporations/SpawnNppPanel";

export function CorporationsAdminPanel() {
  const [state, dispatch] = useCorporationsAdminState();
  const {
    summary,
    corps,
    loading,
    error,
    actionError,
    actionLoading,
    currentTurn,
    confirm,
    inline,
    globalConfirm,
    spawnUnownedLog,
    capitalAmount,
    hqCountry,
    hqRegion,
    appointedCharId,
    appointedCharName,
    imfTargetPct,
    imfAnnualRate,
    imfTurns,
    imfRetention,
    imfIncomeCapture,
    imfPreview,
    imfPreviewLoading,
    imfPreviewError,
    spawnNppForm,
    spawnNppResult,
    spawnNppLoading,
  } = state;

  const fetchData = useCallback(async () => {
    dispatch({ type: "SET_LOADING", value: true });
    dispatch({ type: "SET_ERROR", value: null });
    try {
      const res = await fetch("/api/admin/corporations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      dispatch({ type: "SET_SUMMARY", value: json.summary });
      dispatch({ type: "SET_CORPS", value: json.corporations });
      dispatch({ type: "SET_CURRENT_TURN", value: json.currentTurn ?? 0 });

      const imfRes = await fetch("/api/admin/imf/seed");
      if (imfRes.ok) {
        const imfJson = (await imfRes.json()) as { seeded: boolean };
        // IMF seeded status no longer stored in state; kept for future use
        void imfJson;
      }
    } catch (e) {
      dispatch({ type: "SET_ERROR", value: e instanceof Error ? e.message : "Failed to load" });
    } finally {
      dispatch({ type: "SET_LOADING", value: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (inline?.type !== "imf" || !inline.corpId) {
      dispatch({ type: "SET_IMF_PREVIEW", value: null });
      dispatch({ type: "SET_IMF_PREVIEW_ERROR", value: null });
      return;
    }
    const ac = new AbortController();
    dispatch({ type: "SET_IMF_PREVIEW_LOADING", value: true });
    dispatch({ type: "SET_IMF_PREVIEW_ERROR", value: null });
    const params = new URLSearchParams();
    params.set("retention", imfRetention);
    params.set("annualRate", imfAnnualRate);
    params.set("amortizationTurns", imfTurns);
    params.set("incomeCapturePercent", imfIncomeCapture);
    void fetch(`/api/admin/corporations/${inline.corpId}/imf-bailout?${params.toString()}`, {
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<ImfBailoutPreviewResponse>;
      })
      .then((json) => dispatch({ type: "SET_IMF_PREVIEW", value: json }))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        dispatch({
          type: "SET_IMF_PREVIEW_ERROR",
          value: e instanceof Error ? e.message : "Preview failed",
        });
        dispatch({ type: "SET_IMF_PREVIEW", value: null });
      })
      .finally(() => {
        if (!ac.signal.aborted) dispatch({ type: "SET_IMF_PREVIEW_LOADING", value: false });
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline, imfRetention, imfAnnualRate, imfTurns, imfIncomeCapture]);

  const callAction = async (url: string, method: string, body?: object) => {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    dispatch({ type: "SET_ACTION_LOADING", value: confirm.corpId });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    try {
      const base = `/api/admin/corporations/${confirm.corpId}`;
      switch (confirm.type) {
        case "resetTimers":
          await callAction(`${base}/timers`, "POST");
          break;
        case "forceDividend":
          await callAction(`${base}/dividend`, "POST");
          break;
        case "vacateCeo":
          await callAction(`${base}/ceo`, "DELETE");
          break;
        case "suspend":
          await callAction(`${base}/suspend`, "POST");
          break;
        case "resume":
          await callAction(`${base}/resume`, "POST");
          break;
        case "forceLiquidate":
          await callAction(`${base}/force-liquidate`, "POST", { confirm: true });
          break;
      }
      dispatch({ type: "SET_CONFIRM", value: null });
      await fetchData();
    } catch (e) {
      dispatch({ type: "SET_ACTION_ERROR", value: e instanceof Error ? e.message : "Failed" });
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", value: null });
    }
  };

  const handleGrantCapital = async (corpId: string) => {
    const amount = parseFloat(capitalAmount);
    if (isNaN(amount) || amount === 0) {
      dispatch({ type: "SET_ACTION_ERROR", value: "Enter a non-zero amount" });
      return;
    }
    dispatch({ type: "SET_ACTION_LOADING", value: corpId });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    try {
      await callAction(`/api/admin/corporations/${corpId}/capital`, "POST", { amount });
      dispatch({ type: "SET_INLINE", value: null });
      dispatch({ type: "SET_CAPITAL_AMOUNT", value: "" });
      await fetchData();
    } catch (e) {
      dispatch({ type: "SET_ACTION_ERROR", value: e instanceof Error ? e.message : "Failed" });
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", value: null });
    }
  };

  const handleAppointCeo = async (corpId: string) => {
    if (!appointedCharId) {
      dispatch({ type: "SET_ACTION_ERROR", value: "Select a character first" });
      return;
    }
    dispatch({ type: "SET_ACTION_LOADING", value: corpId });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    try {
      await callAction(`/api/admin/corporations/${corpId}/ceo`, "POST", {
        characterId: appointedCharId,
      });
      dispatch({ type: "SET_INLINE", value: null });
      dispatch({ type: "SET_APPOINTED_CHAR_ID", value: null });
      dispatch({ type: "SET_APPOINTED_CHAR_NAME", value: null });
      await fetchData();
    } catch (e) {
      dispatch({ type: "SET_ACTION_ERROR", value: e instanceof Error ? e.message : "Failed" });
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", value: null });
    }
  };

  const handleImfActivate = async (corpId: string) => {
    const target = parseFloat(imfTargetPct);
    const rate = parseFloat(imfAnnualRate);
    const turns = parseInt(imfTurns, 10);
    const retention = parseFloat(imfRetention);
    if (isNaN(target) || target < 1 || target > 90) {
      dispatch({ type: "SET_ACTION_ERROR", value: "Target ownership % must be 1–90" });
      return;
    }
    if (isNaN(rate) || rate < 0) {
      dispatch({ type: "SET_ACTION_ERROR", value: "Annual rate invalid" });
      return;
    }
    if (isNaN(turns) || turns < 24) {
      dispatch({ type: "SET_ACTION_ERROR", value: "Amortization turns must be at least 24" });
      return;
    }
    if (isNaN(retention) || retention <= 0 || retention > 1) {
      dispatch({ type: "SET_ACTION_ERROR", value: "Bond retention must be between 0 and 1" });
      return;
    }
    dispatch({ type: "SET_ACTION_LOADING", value: corpId });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    try {
      const cap = parseFloat(imfIncomeCapture);
      if (isNaN(cap) || cap < 1 || cap > 45) {
        dispatch({ type: "SET_ACTION_ERROR", value: "Income capture % must be 1–45" });
        return;
      }
      await callAction(`/api/admin/corporations/${corpId}/imf-bailout`, "POST", {
        active: true,
        targetOwnershipPercent: target,
        annualRatePercent: rate,
        amortizationTurns: turns,
        bondHaircutRetention: retention,
        incomeCapturePercent: cap,
      });
      dispatch({ type: "SET_INLINE", value: null });
      await fetchData();
    } catch (e) {
      dispatch({ type: "SET_ACTION_ERROR", value: e instanceof Error ? e.message : "Failed" });
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", value: null });
    }
  };

  const handleImfIncomeCaptureSave = async (corpId: string) => {
    const cap = parseFloat(imfIncomeCapture);
    if (isNaN(cap) || cap < 1 || cap > 45) {
      dispatch({ type: "SET_ACTION_ERROR", value: "Income capture % must be 1–45" });
      return;
    }
    dispatch({ type: "SET_ACTION_LOADING", value: corpId });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    try {
      await callAction(`/api/admin/corporations/${corpId}/imf-bailout`, "PATCH", {
        incomeCapturePercent: cap,
      });
      await fetchData();
    } catch (e) {
      dispatch({ type: "SET_ACTION_ERROR", value: e instanceof Error ? e.message : "Failed" });
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", value: null });
    }
  };

  const handleImfEnd = async (corpId: string) => {
    dispatch({ type: "SET_ACTION_LOADING", value: corpId });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    try {
      await callAction(`/api/admin/corporations/${corpId}/imf-bailout`, "POST", { active: false });
      dispatch({ type: "SET_INLINE", value: null });
      await fetchData();
    } catch (e) {
      dispatch({ type: "SET_ACTION_ERROR", value: e instanceof Error ? e.message : "Failed" });
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", value: null });
    }
  };

  const handleMoveHq = async (corpId: string) => {
    if (!hqRegion.trim()) {
      dispatch({ type: "SET_ACTION_ERROR", value: "Enter a region ID" });
      return;
    }
    dispatch({ type: "SET_ACTION_LOADING", value: corpId });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    try {
      await callAction(`/api/admin/corporations/${corpId}/hq`, "PATCH", {
        countryId: hqCountry,
        regionId: hqRegion.trim(),
      });
      dispatch({ type: "SET_INLINE", value: null });
      dispatch({ type: "SET_HQ_REGION", value: "" });
      await fetchData();
    } catch (e) {
      dispatch({ type: "SET_ACTION_ERROR", value: e instanceof Error ? e.message : "Failed" });
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", value: null });
    }
  };

  const handleGlobalAction = async (type: "resetAll" | "resumeAll" | "spawnUnowned") => {
    dispatch({ type: "SET_ACTION_LOADING", value: type });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    dispatch({ type: "SET_SPAWN_UNOWNED_LOG", value: null });
    try {
      if (type === "resetAll") {
        await callAction("/api/admin/corporations/reset-timers", "POST");
      } else if (type === "resumeAll") {
        await callAction("/api/admin/corporations/resume-all", "POST");
      } else {
        const result = (await callAction("/api/admin/corporations/seed-unowned", "POST")) as {
          boostedCount?: number;
          log?: string[];
        };
        const boosted = result.boostedCount ?? 0;
        const seeded = result.log?.join(" — ") ?? "";
        dispatch({
          type: "SET_SPAWN_UNOWNED_LOG",
          value: `Boosted ${boosted} sectors by 20%. ${seeded}`.trim(),
        });
      }
      dispatch({ type: "SET_GLOBAL_CONFIRM", value: null });
      await fetchData();
    } catch (e) {
      dispatch({ type: "SET_ACTION_ERROR", value: e instanceof Error ? e.message : "Failed" });
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", value: null });
    }
  };

  const openInline = (panel: InlinePanel) => {
    dispatch({
      type: "SET_INLINE",
      value: inline?.corpId === panel?.corpId && inline?.type === panel?.type ? null : panel,
    });
    dispatch({ type: "SET_CONFIRM", value: null });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    dispatch({ type: "SET_CAPITAL_AMOUNT", value: "" });
    dispatch({ type: "SET_APPOINTED_CHAR_ID", value: null });
    dispatch({ type: "SET_APPOINTED_CHAR_NAME", value: null });
    dispatch({ type: "SET_HQ_REGION", value: "" });
  };

  const openImfPanel = (row: CorpRow) => {
    if (inline?.corpId === row.id && inline?.type === "imf") {
      dispatch({ type: "SET_INLINE", value: null });
      return;
    }
    dispatch({ type: "SET_INLINE", value: { type: "imf", corpId: row.id } });
    dispatch({ type: "SET_CONFIRM", value: null });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
    dispatch({ type: "SET_IMF_PREVIEW", value: null });
    dispatch({ type: "SET_IMF_PREVIEW_ERROR", value: null });
    if (row.imfBailoutActive) {
      dispatch({ type: "SET_IMF_ANNUAL_RATE", value: String(row.imfFacilityAnnualRate ?? 6) });
      dispatch({
        type: "SET_IMF_TURNS",
        value: String(row.imfFacilityAmortizationTurnsRemaining ?? 240),
      });
      if (row.imfFacilityIncomeCaptureFraction != null) {
        dispatch({
          type: "SET_IMF_INCOME_CAPTURE",
          value: String(Math.round(row.imfFacilityIncomeCaptureFraction * 1000) / 10),
        });
      } else {
        dispatch({ type: "SET_IMF_INCOME_CAPTURE", value: "35" });
      }
    } else {
      dispatch({ type: "SET_IMF_TARGET_PCT", value: "40" });
      dispatch({ type: "SET_IMF_ANNUAL_RATE", value: "6" });
      dispatch({ type: "SET_IMF_TURNS", value: "240" });
      dispatch({ type: "SET_IMF_RETENTION", value: "0.7" });
      dispatch({ type: "SET_IMF_INCOME_CAPTURE", value: "35" });
    }
  };

  const openConfirm = (action: ConfirmAction) => {
    dispatch({
      type: "SET_CONFIRM",
      value: confirm?.corpId === action?.corpId && confirm?.type === action?.type ? null : action,
    });
    dispatch({ type: "SET_INLINE", value: null });
    dispatch({ type: "SET_ACTION_ERROR", value: null });
  };

  return (
    <div className="space-y-6">
      <SubsidiaryCorporationsToggle />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Corporations</h2>
        <div className="flex gap-2">
          <button
            onClick={() =>
              dispatch({
                type: "SET_GLOBAL_CONFIRM",
                value: globalConfirm === "resetAll" ? null : "resetAll",
              })
            }
            className="text-xs px-3 py-1.5 rounded border border-card-border hover:bg-background/60 transition-colors"
          >
            Reset All Timers
          </button>
          <button
            onClick={() =>
              dispatch({
                type: "SET_GLOBAL_CONFIRM",
                value: globalConfirm === "resumeAll" ? null : "resumeAll",
              })
            }
            className="text-xs px-3 py-1.5 rounded border border-card-border hover:bg-background/60 transition-colors"
          >
            Resume All Suspended
          </button>
          <button
            onClick={() =>
              dispatch({
                type: "SET_GLOBAL_CONFIRM",
                value: globalConfirm === "spawnUnowned" ? null : "spawnUnowned",
              })
            }
            className="text-xs px-3 py-1.5 rounded border border-card-border hover:bg-background/60 transition-colors"
          >
            Spawn Unowned (20% Boost)
          </button>
          <button
            onClick={() =>
              dispatch({
                type: "SET_INLINE",
                value: inline?.type === "spawnNpp" ? null : { type: "spawnNpp", corpId: "global" },
              })
            }
            className="text-xs px-3 py-1.5 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
          >
            Spawn NPP Corp
          </button>
        </div>
      </div>

      {/* Spawn unowned result */}
      {spawnUnownedLog && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-success/10 border border-success/30 px-4 py-3 text-sm">
          <span className="text-success">{spawnUnownedLog}</span>
          <button
            onClick={() => dispatch({ type: "SET_SPAWN_UNOWNED_LOG", value: null })}
            className="text-xs text-muted hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Spawn NPP Corp inline panel */}
      {inline?.type === "spawnNpp" && (
        <SpawnNppPanel
          spawnNppForm={spawnNppForm}
          spawnNppResult={spawnNppResult}
          spawnNppLoading={spawnNppLoading}
          dispatch={dispatch}
          fetchData={fetchData}
        />
      )}

      {/* Global confirm strip */}
      {globalConfirm && (
        <GlobalConfirmStrip
          globalConfirm={globalConfirm}
          actionLoading={actionLoading}
          onConfirm={handleGlobalAction}
          dispatch={dispatch}
        />
      )}

      {/* Summary cards */}
      {summary && <CorpSummaryCards summary={summary} />}

      {error && <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{error}</p>}
      {actionError && (
        <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{actionError}</p>
      )}

      {loading ? (
        <div className="text-muted text-sm py-8 text-center">Loading…</div>
      ) : (
        <CorporationsTable
          corps={corps}
          currentTurn={currentTurn}
          confirm={confirm}
          inline={inline}
          actionLoading={actionLoading}
          capitalAmount={capitalAmount}
          appointedCharId={appointedCharId}
          appointedCharName={appointedCharName}
          hqCountry={hqCountry}
          hqRegion={hqRegion}
          imfTargetPct={imfTargetPct}
          imfAnnualRate={imfAnnualRate}
          imfTurns={imfTurns}
          imfRetention={imfRetention}
          imfIncomeCapture={imfIncomeCapture}
          imfPreview={imfPreview}
          imfPreviewLoading={imfPreviewLoading}
          imfPreviewError={imfPreviewError}
          dispatch={dispatch}
          onConfirm={handleConfirm}
          onGrantCapital={handleGrantCapital}
          onAppointCeo={handleAppointCeo}
          onMoveHq={handleMoveHq}
          onImfActivate={handleImfActivate}
          onImfIncomeCaptureSave={handleImfIncomeCaptureSave}
          onImfEnd={handleImfEnd}
          openInline={openInline}
          openImfPanel={openImfPanel}
          openConfirm={openConfirm}
        />
      )}
    </div>
  );
}
