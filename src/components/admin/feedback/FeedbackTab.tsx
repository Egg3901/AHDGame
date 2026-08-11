"use client";

import { useReducer, useEffect, useCallback } from "react";
import { PAGE_SIZE, STAGES, type StatusKey, type FeedbackItem, type FeedbackDetail } from "./types";
import { FeedbackFilters } from "./FeedbackFilters";
import { FeedbackList } from "./FeedbackList";
import { FeedbackDetail as FeedbackDetailPanel } from "./FeedbackDetail";

// ─── Reducer ──────────────────────────────────────────────────────────────────

interface FeedbackTabState {
  activeStage: string;
  typeFilter: string;
  page: number;
  items: FeedbackItem[];
  total: number;
  stageCounts: Record<string, number>;
  loading: boolean;
  error: string;
  syncing: boolean;
  syncMessage: string;
  selectedId: string | null;
  detail: FeedbackDetail | null;
  detailLoading: boolean;
  screenshotExpanded: boolean;
  updating: boolean;
  newStatus: string;
  adminNotes: string;
  updateMessage: string;
}

const initialFeedbackTabState: FeedbackTabState = {
  activeStage: "open",
  typeFilter: "",
  page: 0,
  items: [],
  total: 0,
  stageCounts: {},
  loading: false,
  error: "",
  syncing: false,
  syncMessage: "",
  selectedId: null,
  detail: null,
  detailLoading: false,
  screenshotExpanded: false,
  updating: false,
  newStatus: "",
  adminNotes: "",
  updateMessage: "",
};

type FeedbackTabAction =
  | { type: "SET_STAGE"; stage: string }
  | { type: "SET_TYPE_FILTER"; filter: string }
  | { type: "SET_PAGE"; page: number }
  | { type: "LIST_LOAD_START" }
  | {
      type: "LIST_LOAD_SUCCESS";
      items: FeedbackItem[];
      total: number;
    }
  | { type: "LIST_LOAD_ERROR"; error: string }
  | { type: "SYNC_START" }
  | { type: "SYNC_SUCCESS"; message: string }
  | { type: "SELECT_ITEM"; id: string }
  | { type: "DETAIL_LOAD_START" }
  | { type: "DETAIL_LOAD_SUCCESS"; detail: FeedbackDetail }
  | { type: "TOGGLE_SCREENSHOT" }
  | { type: "UPDATE_START" }
  | { type: "UPDATE_SUCCESS"; message: string }
  | { type: "SET_NEW_STATUS"; status: string }
  | { type: "SET_ADMIN_NOTES"; notes: string }
  | { type: "CLEAR_SELECTED" }
  | { type: "SET_ERROR"; error: string }
  | { type: "SET_UPDATE_MESSAGE"; message: string }
  | { type: "SET_STAGE_COUNTS"; stageCounts: Record<string, number> }
  | { type: "UPDATE_DETAIL"; newStatus: string; adminNotes: string };

function feedbackTabReducer(state: FeedbackTabState, action: FeedbackTabAction): FeedbackTabState {
  switch (action.type) {
    case "SET_STAGE":
      return { ...state, activeStage: action.stage, page: 0, items: [] };
    case "SET_TYPE_FILTER":
      return { ...state, typeFilter: action.filter, page: 0 };
    case "SET_PAGE":
      return { ...state, page: action.page };
    case "LIST_LOAD_START":
      return { ...state, loading: true, error: "" };
    case "LIST_LOAD_SUCCESS":
      return {
        ...state,
        loading: false,
        items: action.items,
        total: action.total,
      };
    case "LIST_LOAD_ERROR":
      return { ...state, loading: false, error: action.error };
    case "SYNC_START":
      return { ...state, syncing: true, syncMessage: "" };
    case "SYNC_SUCCESS":
      return { ...state, syncing: false, syncMessage: action.message };
    case "SELECT_ITEM":
      return {
        ...state,
        selectedId: action.id,
        detail: null,
        detailLoading: true,
        screenshotExpanded: false,
      };
    case "DETAIL_LOAD_START":
      return { ...state, detailLoading: true };
    case "DETAIL_LOAD_SUCCESS":
      return {
        ...state,
        detailLoading: false,
        detail: action.detail,
        newStatus: action.detail.status,
        adminNotes: action.detail.adminNotes ?? "",
      };
    case "TOGGLE_SCREENSHOT":
      return { ...state, screenshotExpanded: !state.screenshotExpanded };
    case "UPDATE_START":
      return { ...state, updating: true, updateMessage: "" };
    case "UPDATE_SUCCESS":
      return { ...state, updating: false, updateMessage: action.message };
    case "SET_NEW_STATUS":
      return { ...state, newStatus: action.status };
    case "SET_ADMIN_NOTES":
      return { ...state, adminNotes: action.notes };
    case "CLEAR_SELECTED":
      return { ...state, selectedId: null };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_UPDATE_MESSAGE":
      return { ...state, updateMessage: action.message };
    case "SET_STAGE_COUNTS":
      return { ...state, stageCounts: action.stageCounts };
    case "UPDATE_DETAIL":
      return {
        ...state,
        detail: state.detail
          ? {
              ...state.detail,
              status: action.newStatus,
              adminNotes: action.adminNotes.trim() || undefined,
            }
          : null,
      };
    default:
      return state;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FeedbackTab({ initialIssueNumber }: { initialIssueNumber?: number }) {
  const [state, dispatch] = useReducer(feedbackTabReducer, initialFeedbackTabState);
  const {
    activeStage,
    typeFilter,
    page,
    items,
    total,
    stageCounts,
    loading,
    error,
    syncing,
    syncMessage,
    selectedId,
    detail,
    detailLoading,
    screenshotExpanded,
    updating,
    newStatus,
    adminNotes,
    updateMessage,
  } = state;

  const fetchList = useCallback(async () => {
    try {
      dispatch({ type: "LIST_LOAD_START" });
      const params = new URLSearchParams();
      if (activeStage !== "all") params.set("status", activeStage);
      if (typeFilter) params.set("type", typeFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      const res = await fetch(`/api/admin/feedback?${params}`);
      const data = await res.json();
      if (res.ok) {
        dispatch({
          type: "LIST_LOAD_SUCCESS",
          items: data.items,
          total: data.total,
        });
      } else {
        dispatch({ type: "LIST_LOAD_ERROR", error: data.error ?? "Failed to fetch" });
      }
    } catch {
      dispatch({ type: "LIST_LOAD_ERROR", error: "Network error" });
    }
  }, [activeStage, typeFilter, page]);

  // Fetch stage counts for tab badges (always unfiltered by type for accuracy)
  const fetchStageCounts = useCallback(async () => {
    try {
      const results = await Promise.all(
        STAGES.map(async (s) => {
          const params = new URLSearchParams({ status: s.key, limit: "1", offset: "0" });
          if (typeFilter) params.set("type", typeFilter);
          const res = await fetch(`/api/admin/feedback?${params}`);
          const data = await res.json();
          return [s.key, res.ok ? data.total : 0] as [string, number];
        })
      );
      dispatch({ type: "SET_STAGE_COUNTS", stageCounts: Object.fromEntries(results) });
    } catch {
      /* non-fatal */
    }
  }, [typeFilter]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchStageCounts();
  }, [fetchStageCounts]);

  // Reset page when filters change
  useEffect(() => {
    dispatch({ type: "SET_PAGE", page: 0 });
  }, [activeStage, typeFilter]);

  const fetchDetail = useCallback(async (issueNumberStr: string) => {
    dispatch({ type: "SELECT_ITEM", id: issueNumberStr });
    try {
      const res = await fetch(`/api/feedback/${issueNumberStr}`);
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "DETAIL_LOAD_SUCCESS", detail: data });
        if (data.screenshotUrl) {
          dispatch({ type: "TOGGLE_SCREENSHOT" });
        }
      } else {
        dispatch({ type: "SET_ERROR", error: data.error ?? "Failed to fetch" });
      }
    } catch {
      dispatch({ type: "SET_ERROR", error: "Network error" });
    }
  }, []);

  // Auto-load deep-linked issue on mount or when initialIssueNumber changes
  useEffect(() => {
    if (initialIssueNumber) {
      fetchDetail(String(initialIssueNumber));
    }
  }, [initialIssueNumber, fetchDetail]);

  const handleUpdateStatus = async () => {
    if (!selectedId || !detail) return;
    if (newStatus === detail.status && adminNotes === (detail.adminNotes ?? "")) {
      dispatch({ type: "SET_UPDATE_MESSAGE", message: "No changes" });
      return;
    }
    dispatch({ type: "UPDATE_START" });
    try {
      const res = await fetch(`/api/admin/feedback/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, adminNotes: adminNotes.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "UPDATE_SUCCESS", message: "✓ Updated" });
        dispatch({ type: "UPDATE_DETAIL", newStatus, adminNotes });
        fetchList();
        fetchStageCounts();
      } else {
        dispatch({ type: "SET_UPDATE_MESSAGE", message: `✗ ${data.error}` });
        dispatch({ type: "UPDATE_SUCCESS", message: `✗ ${data.error}` });
      }
    } catch {
      dispatch({ type: "UPDATE_SUCCESS", message: "✗ Network error" });
    }
  };

  const handleSyncWithGitHub = async () => {
    if (
      !confirm(
        "Sync feedback with GitHub? New issues will be created for entries not yet logged, and all linked issues will have their status updated."
      )
    )
      return;
    dispatch({ type: "SYNC_START" });
    try {
      const res = await fetch("/api/admin/feedback/backfill-github", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const parts: string[] = [];
        if (data.created > 0) parts.push(`${data.created} created`);
        if (data.failed > 0) parts.push(`${data.failed} failed`);
        if (data.synced > 0) parts.push(`${data.synced} synced`);
        dispatch({
          type: "SYNC_SUCCESS",
          message: `✓ ${parts.length > 0 ? parts.join(", ") : "Up to date"}`,
        });
        // Always refresh — statuses may have changed on GitHub
        fetchList();
        if (selectedId) fetchDetail(selectedId);
      } else {
        dispatch({ type: "SYNC_SUCCESS", message: `✗ ${data.error ?? "Failed"}` });
      }
    } catch {
      dispatch({ type: "SYNC_SUCCESS", message: "✗ Network error" });
    }
  };

  return (
    <div className="space-y-4">
      <FeedbackFilters
        typeFilter={typeFilter}
        onTypeFilterChange={(f) => dispatch({ type: "SET_TYPE_FILTER", filter: f })}
        activeStage={activeStage as StatusKey | "all"}
        onStageChange={(s) => dispatch({ type: "SET_STAGE", stage: s })}
        stageCounts={stageCounts}
        syncing={syncing}
        syncMessage={syncMessage}
        onSyncWithGitHub={handleSyncWithGitHub}
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <FeedbackList
          loading={loading}
          items={items}
          total={total}
          page={page}
          selectedId={selectedId}
          onSelectItem={fetchDetail}
          onPageChange={(p) => dispatch({ type: "SET_PAGE", page: p })}
        />

        <FeedbackDetailPanel
          detail={detail}
          detailLoading={detailLoading}
          selectedId={selectedId}
          newStatus={newStatus}
          adminNotes={adminNotes}
          updating={updating}
          updateMessage={updateMessage}
          screenshotExpanded={screenshotExpanded}
          onClose={() => dispatch({ type: "CLEAR_SELECTED" })}
          onStatusChange={(s) => dispatch({ type: "SET_NEW_STATUS", status: s })}
          onAdminNotesChange={(n) => dispatch({ type: "SET_ADMIN_NOTES", notes: n })}
          onUpdateStatus={handleUpdateStatus}
          onToggleScreenshot={() => dispatch({ type: "TOGGLE_SCREENSHOT" })}
        />
      </div>
    </div>
  );
}
