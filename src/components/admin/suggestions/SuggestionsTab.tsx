"use client";

import { useReducer, useEffect, useCallback, useState } from "react";
import { EmptyState } from "@/components/ui";
import { SelectionBar } from "@/components/suggestions/SelectionBar";
import {
  PAGE_SIZE,
  STAGES,
  STATUS_COLORS,
  STATUS_OPTIONS,
  priorityLabel,
  priorityColor,
  type SuggestionAdminItem,
  type SuggestionAdminDetail,
} from "./types";

interface State {
  activeStage: string;
  page: number;
  items: SuggestionAdminItem[];
  total: number;
  stageCounts: Record<string, number>;
  loading: boolean;
  error: string;
  selectedId: string | null;
  detail: SuggestionAdminDetail | null;
  detailLoading: boolean;
  updating: boolean;
  newStatus: string;
  adminNotes: string;
  updateMessage: string;
}

const initialState: State = {
  activeStage: "all",
  page: 0,
  items: [],
  total: 0,
  stageCounts: {},
  loading: false,
  error: "",
  selectedId: null,
  detail: null,
  detailLoading: false,
  updating: false,
  newStatus: "",
  adminNotes: "",
  updateMessage: "",
};

type Action =
  | { type: "SET_STAGE"; stage: string }
  | { type: "SET_PAGE"; page: number }
  | { type: "LIST_START" }
  | { type: "LIST_SUCCESS"; items: SuggestionAdminItem[]; total: number }
  | { type: "LIST_ERROR"; error: string }
  | { type: "SELECT"; id: string }
  | { type: "DETAIL_START" }
  | { type: "DETAIL_SUCCESS"; detail: SuggestionAdminDetail }
  | { type: "UPDATE_START" }
  | { type: "UPDATE_DONE"; msg: string }
  | { type: "SET_STATUS"; status: string }
  | { type: "SET_NOTES"; notes: string }
  | { type: "CLEAR" }
  | { type: "SET_ERR"; error: string }
  | { type: "SET_COUNTS"; counts: Record<string, number> }
  | { type: "PATCH_DETAIL"; status: string; adminNotes: string }
  | { type: "PATCH_LIST_STATUS"; issueNumber: number; status: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_STAGE":
      return { ...state, activeStage: action.stage, page: 0 };
    case "SET_PAGE":
      return { ...state, page: action.page };
    case "LIST_START":
      return { ...state, loading: true, error: "" };
    case "LIST_SUCCESS":
      return { ...state, loading: false, items: action.items, total: action.total };
    case "LIST_ERROR":
      return { ...state, loading: false, error: action.error };
    case "SELECT":
      return {
        ...state,
        selectedId: action.id,
        detail: null,
        detailLoading: true,
      };
    case "DETAIL_START":
      return { ...state, detailLoading: true };
    case "DETAIL_SUCCESS":
      return {
        ...state,
        detailLoading: false,
        detail: action.detail,
        newStatus: action.detail.status,
        adminNotes: action.detail.adminNotes ?? "",
      };
    case "UPDATE_START":
      return { ...state, updating: true, updateMessage: "" };
    case "UPDATE_DONE":
      return { ...state, updating: false, updateMessage: action.msg };
    case "SET_STATUS":
      return { ...state, newStatus: action.status };
    case "SET_NOTES":
      return { ...state, adminNotes: action.notes };
    case "CLEAR":
      return { ...state, selectedId: null };
    case "SET_ERR":
      return { ...state, error: action.error };
    case "SET_COUNTS":
      return { ...state, stageCounts: action.counts };
    case "PATCH_DETAIL":
      return {
        ...state,
        detail: state.detail
          ? {
              ...state.detail,
              status: action.status,
              adminNotes: action.adminNotes.trim() || "",
            }
          : null,
      };
    case "PATCH_LIST_STATUS":
      return {
        ...state,
        items: state.items.map((it) =>
          it.issueNumber === action.issueNumber ? { ...it, status: action.status } : it
        ),
        detail:
          state.detail?.issueNumber === action.issueNumber
            ? { ...state.detail, status: action.status }
            : state.detail,
      };
    default:
      return state;
  }
}

export function SuggestionsTab({ initialIssueNumber }: { initialIssueNumber?: number }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [selectedIssueNums, setSelectedIssueNums] = useState<Set<number>>(new Set());

  const fetchList = useCallback(async () => {
    dispatch({ type: "LIST_START" });
    try {
      const params = new URLSearchParams();
      if (state.activeStage !== "all") params.set("status", state.activeStage);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(state.page * PAGE_SIZE));
      const res = await fetch(`/api/admin/suggestions?${params}`);
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: "LIST_ERROR", error: data.error ?? "Failed" });
        return;
      }
      dispatch({
        type: "LIST_SUCCESS",
        items: data.items,
        total: data.total,
      });
    } catch {
      dispatch({ type: "LIST_ERROR", error: "Network error" });
    }
  }, [state.activeStage, state.page]);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/suggestions/counts");
      const data = await res.json();
      if (!res.ok) return;
      dispatch({ type: "SET_COUNTS", counts: data.counts ?? {} });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    dispatch({ type: "SET_PAGE", page: 0 });
  }, [state.activeStage]);

  const fetchDetail = useCallback(async (issueNumStr: string) => {
    dispatch({ type: "SELECT", id: issueNumStr });
    try {
      const res = await fetch(`/api/admin/suggestions/${issueNumStr}`);
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: "SET_ERR", error: data.error ?? "Failed" });
        return;
      }
      dispatch({ type: "DETAIL_SUCCESS", detail: data });
    } catch {
      dispatch({ type: "SET_ERR", error: "Network error" });
    }
  }, []);

  useEffect(() => {
    if (initialIssueNumber) void fetchDetail(String(initialIssueNumber));
  }, [initialIssueNumber, fetchDetail]);

  const patchStatusInline = async (
    issueNumber: number,
    nextStatus: string,
    currentStatus: string
  ) => {
    if (nextStatus === currentStatus) return;
    try {
      const res = await fetch(`/api/admin/suggestions/${issueNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: "SET_ERR", error: data.error ?? "Update failed" });
        return;
      }
      dispatch({ type: "PATCH_LIST_STATUS", issueNumber, status: nextStatus });
      void fetchCounts();
    } catch {
      dispatch({ type: "SET_ERR", error: "Network error" });
    }
  };

  const handleUpdate = async () => {
    if (!state.selectedId || !state.detail) return;
    if (
      state.newStatus === state.detail.status &&
      state.adminNotes === (state.detail.adminNotes ?? "")
    ) {
      dispatch({ type: "UPDATE_DONE", msg: "No changes" });
      return;
    }
    dispatch({ type: "UPDATE_START" });
    try {
      const res = await fetch(`/api/admin/suggestions/${state.selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: state.newStatus,
          adminNotes: state.adminNotes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: "UPDATE_DONE", msg: `✗ ${data.error}` });
        return;
      }
      dispatch({ type: "UPDATE_DONE", msg: "✓ Updated" });
      dispatch({
        type: "PATCH_DETAIL",
        status: state.newStatus,
        adminNotes: state.adminNotes,
      });
      void fetchList();
      void fetchCounts();
    } catch {
      dispatch({ type: "UPDATE_DONE", msg: "✗ Network error" });
    }
  };

  // Multi-select handlers
  const toggleRowSelect = useCallback((issueNumber: number) => {
    setSelectedIssueNums((prev) => {
      const next = new Set(prev);
      if (next.has(issueNumber)) next.delete(issueNumber);
      else next.add(issueNumber);
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setSelectedIssueNums(new Set());
  }, []);

  const handleMerge = useCallback(async () => {
    const selected = state.items.filter((i) => selectedIssueNums.has(i.issueNumber));
    if (selected.length < 2) return;
    const target = selected[0];
    const sources = selected.slice(1);
    try {
      const res = await fetch("/api/admin/suggestions/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetIssueNumber: target.issueNumber,
          sourceIssueNumbers: sources.map((s) => s.issueNumber),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: "SET_ERR", error: data.error ?? "Merge failed" });
        return;
      }
      setSelectedIssueNums(new Set());
      void fetchList();
      void fetchCounts();
    } catch {
      dispatch({ type: "SET_ERR", error: "Network error during merge" });
    }
  }, [state.items, selectedIssueNums, fetchList, fetchCounts]);

  const handleBulkDelete = useCallback(async () => {
    const selected = state.items.filter((i) => selectedIssueNums.has(i.issueNumber));
    if (selected.length === 0) return;
    if (!window.confirm(`Delete ${selected.length} suggestion${selected.length === 1 ? "" : "s"}?`))
      return;
    try {
      const res = await fetch("/api/admin/suggestions/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueNumbers: selected.map((s) => s.issueNumber) }),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: "SET_ERR", error: data.error ?? "Delete failed" });
        return;
      }
      setSelectedIssueNums(new Set());
      void fetchList();
      void fetchCounts();
    } catch {
      dispatch({ type: "SET_ERR", error: "Network error during delete" });
    }
  }, [state.items, selectedIssueNums, fetchList, fetchCounts]);

  const handleDeleteSingle = useCallback(
    async (issueNumber: number) => {
      if (!window.confirm(`Delete S#${issueNumber}?`)) return;
      try {
        const res = await fetch(`/api/admin/suggestions/${issueNumber}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json();
          dispatch({ type: "SET_ERR", error: data.error ?? "Delete failed" });
          return;
        }
        dispatch({ type: "CLEAR" });
        void fetchList();
        void fetchCounts();
      } catch {
        dispatch({ type: "SET_ERR", error: "Network error" });
      }
    },
    [fetchList, fetchCounts]
  );

  const totalPages = Math.ceil(state.total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Player suggestions use the <code className="text-xs">suggestions</code> collection (legacy
        bugs: Support &rarr; Feedback). Select rows with checkboxes for bulk merge or delete.
      </p>

      <div className="flex flex-wrap gap-1 rounded-xl border border-card-border bg-background p-1">
        <button
          type="button"
          onClick={() => dispatch({ type: "SET_STAGE", stage: "all" })}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            state.activeStage === "all"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          All
        </button>
        {STAGES.map((s) => (
          <button
            key={String(s.key)}
            type="button"
            onClick={() => dispatch({ type: "SET_STAGE", stage: s.key })}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              state.activeStage === s.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {s.label}
            {state.stageCounts[s.key as string] != null && (
              <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-xs ${s.color}`}>
                {state.stageCounts[s.key as string]}
              </span>
            )}
          </button>
        ))}
      </div>

      {state.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {state.error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="rounded-xl border border-card-border bg-card overflow-hidden flex flex-col shadow-sm">
          <div className="overflow-x-auto flex-1">
            {state.loading ? (
              <div className="p-8 text-center text-muted">Loading…</div>
            ) : state.items.length === 0 ? (
              <div className="p-8">
                <EmptyState title="Nothing here" description="No suggestions match." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b border-card-border">
                    <tr>
                      <th className="px-2 py-3 w-8">
                        <input
                          type="checkbox"
                          checked={
                            state.items.length > 0 &&
                            state.items.every((i) => selectedIssueNums.has(i.issueNumber))
                          }
                          ref={(el) => {
                            if (el)
                              el.indeterminate =
                                state.items.some((i) => selectedIssueNums.has(i.issueNumber)) &&
                                !state.items.every((i) => selectedIssueNums.has(i.issueNumber));
                          }}
                          onChange={() => {
                            const allSelected = state.items.every((i) =>
                              selectedIssueNums.has(i.issueNumber)
                            );
                            if (allSelected) {
                              setSelectedIssueNums(new Set());
                            } else {
                              setSelectedIssueNums(new Set(state.items.map((i) => i.issueNumber)));
                            }
                          }}
                          className="rounded border-card-border"
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-3 py-3 text-left font-medium text-muted">S#</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Cat / Area</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Title</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Pri</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Status</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Comments</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Reporter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.items.map((item) => {
                      const pl = priorityLabel(item.priority);
                      const pc = priorityColor(item.priority);
                      const isSelected = selectedIssueNums.has(item.issueNumber);
                      return (
                        <tr
                          key={item.id}
                          className={`border-b border-card-border cursor-pointer transition-colors hover:bg-background/60 ${
                            isSelected
                              ? "bg-primary/10"
                              : state.selectedId === String(item.issueNumber)
                                ? "bg-primary/5"
                                : ""
                          }`}
                        >
                          <td
                            className="px-2 py-2.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRowSelect(item.issueNumber);
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRowSelect(item.issueNumber)}
                              className="rounded border-card-border"
                              aria-label={`Select S#${item.issueNumber}`}
                            />
                          </td>
                          <td
                            className="px-3 py-2.5 font-mono text-xs text-muted whitespace-nowrap"
                            onClick={() => void fetchDetail(String(item.issueNumber))}
                          >
                            S#{item.issueNumber}
                          </td>
                          <td
                            className="px-3 py-2.5 text-xs text-muted capitalize"
                            onClick={() => void fetchDetail(String(item.issueNumber))}
                          >
                            {item.category.replace(/_/g, " ")}
                            <br />
                            <span className="text-muted/80">
                              {item.gameSystem.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td
                            className="px-3 py-2.5 max-w-[200px]"
                            onClick={() => void fetchDetail(String(item.issueNumber))}
                          >
                            <span className="line-clamp-2 text-sm" title={item.title}>
                              {item.title}
                            </span>
                          </td>
                          <td
                            className="px-3 py-2.5 whitespace-nowrap"
                            onClick={() => void fetchDetail(String(item.issueNumber))}
                          >
                            {pl ? (
                              <span className={`text-xs font-medium ${pc}`}>{pl}</span>
                            ) : (
                              <span className="text-xs text-muted/40">&mdash;</span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2.5"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <select
                              value={item.status}
                              onChange={(e) =>
                                void patchStatusInline(
                                  item.issueNumber,
                                  e.target.value,
                                  item.status
                                )
                              }
                              className={`max-w-[140px] rounded-md border border-card-border bg-background px-2 py-1 text-xs capitalize ${STATUS_COLORS[item.status] ?? ""}`}
                              aria-label={`Status for S#${item.issueNumber}`}
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s.value} value={s.value}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td
                            className="px-3 py-2.5 text-xs tabular-nums"
                            onClick={() => void fetchDetail(String(item.issueNumber))}
                          >
                            <span>{item.commentCount}</span>
                            {(item.unreadCommentCount ?? 0) > 0 && (
                              <span className="ml-1.5 inline-flex rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                +{item.unreadCommentCount} new
                              </span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2.5 text-xs align-top"
                            onClick={() => void fetchDetail(String(item.issueNumber))}
                          >
                            <div className="flex max-w-[200px] flex-col gap-1">
                              {item.reporterCharacterName ? (
                                <span className="w-fit rounded-md border border-card-border bg-card-elevated px-2 py-0.5 font-medium text-foreground">
                                  {item.reporterCharacterName}
                                </span>
                              ) : null}
                              <div className="flex flex-wrap gap-1">
                                {item.reporterUsername ? (
                                  <span className="rounded bg-muted/25 px-1.5 py-0.5 text-muted">
                                    @{item.reporterUsername}
                                  </span>
                                ) : null}
                                {item.reporterDiscordUsername ? (
                                  <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-indigo-300">
                                    Discord: {item.reporterDiscordUsername}
                                  </span>
                                ) : null}
                                {!item.reporterCharacterName &&
                                  !item.reporterUsername &&
                                  !item.reporterDiscordUsername && (
                                    <span className="text-muted">&mdash;</span>
                                  )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-card-border px-4 py-2">
              <span className="text-xs text-muted">
                {state.page * PAGE_SIZE + 1}&ndash;
                {Math.min((state.page + 1) * PAGE_SIZE, state.total)} of {state.total}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "SET_PAGE", page: Math.max(0, state.page - 1) })}
                  disabled={state.page === 0}
                  className="rounded border border-card-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-background disabled:opacity-40"
                >
                  &lsaquo; Prev
                </button>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_PAGE",
                      page: Math.min(totalPages - 1, state.page + 1),
                    })
                  }
                  disabled={state.page >= totalPages - 1}
                  className="rounded border border-card-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-background disabled:opacity-40"
                >
                  Next &rsaquo;
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="rounded-xl border border-card-border bg-card p-5 space-y-4 overflow-y-auto max-h-[700px] shadow-sm">
          {state.detailLoading ? (
            <div className="py-12 text-center text-muted">Loading…</div>
          ) : !state.detail ? (
            <div className="py-12 text-center text-muted">Select a suggestion</div>
          ) : (
            <>
              <div>
                <p className="font-mono text-xs text-muted">S#{state.detail.issueNumber}</p>
                <h3 className="mt-1 font-semibold">{state.detail.title}</h3>
                <p className="mt-1 text-xs text-muted capitalize">
                  {state.detail.category.replace(/_/g, " ")} &middot;{" "}
                  {state.detail.gameSystem.replace(/_/g, " ")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {state.detail.reporterCharacterName ? (
                    <span className="rounded-md border border-card-border bg-card-elevated px-2 py-0.5 text-xs font-medium text-foreground normal-case">
                      {state.detail.reporterCharacterName}
                    </span>
                  ) : null}
                  {state.detail.reporterUsername ? (
                    <span className="rounded-md bg-muted/25 px-2 py-0.5 text-xs text-muted normal-case">
                      @{state.detail.reporterUsername}
                    </span>
                  ) : null}
                  {state.detail.reporterDiscordUsername ? (
                    <span className="rounded-md bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-300 normal-case">
                      Discord: {state.detail.reporterDiscordUsername}
                    </span>
                  ) : null}
                  {!state.detail.reporterCharacterName &&
                    !state.detail.reporterUsername &&
                    !state.detail.reporterDiscordUsername && (
                      <span className="text-xs text-muted normal-case">Anonymous</span>
                    )}
                </div>
              </div>
              <div className="text-sm whitespace-pre-wrap">{state.detail.description}</div>
              <label className="block text-sm font-medium text-muted">Status</label>
              <select
                value={state.newStatus}
                onChange={(e) => dispatch({ type: "SET_STATUS", status: e.target.value })}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <label className="block text-sm font-medium text-muted">Admin notes</label>
              <textarea
                value={state.adminNotes}
                onChange={(e) => dispatch({ type: "SET_NOTES", notes: e.target.value })}
                rows={3}
                className="w-full resize-none rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleUpdate()}
                  disabled={state.updating}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {state.updating ? "Updating…" : "Update"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteSingle(state.detail!.issueNumber)}
                  className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Delete
                </button>
                {state.updateMessage && (
                  <span
                    className={`text-sm ${state.updateMessage.startsWith("✓") ? "text-green-500" : "text-red-400"}`}
                  >
                    {state.updateMessage}
                  </span>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {selectedIssueNums.size > 0 && (
        <SelectionBar
          selectedCount={selectedIssueNums.size}
          onMerge={handleMerge}
          onDelete={handleBulkDelete}
          onCancel={cancelSelection}
        />
      )}
    </div>
  );
}
