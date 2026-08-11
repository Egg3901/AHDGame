"use client";

import { useEffect, useCallback, useState } from "react";
import { WikiPageForm } from "./WikiPageForm";
import { WikiPageTable } from "./WikiPageTable";
import type { WikiPageRow } from "./WikiPageTable";
import { useWikiManagementState } from "./useWikiManagementState";

interface ReseedResult {
  inserted?: string[];
  updated?: string[];
  skipped?: { slug: string; reason: string }[];
}

interface SyncPriorResult {
  renamed?: { oldSlug: string; newSlug: string; kind: "player" | "corporation" | "party" }[];
  skipped?: { oldSlug: string; reason: string }[];
}

interface WikiManagementTabProps {
  /**
   * When true, exposes admin-only controls (wiki access toggle, reseed/force reseed).
   * Moderators see the same create/edit/delete workflow without those controls.
   */
  isAdmin?: boolean;
}

export function WikiManagementTab({ isAdmin = true }: WikiManagementTabProps = {}) {
  const [state, dispatch] = useWikiManagementState();
  const {
    pages,
    loading,
    error,
    creating,
    editingSlug,
    formSlug,
    formTitle,
    formDescription,
    formContent,
    formFeatured,
    saving,
    reseedMode,
    reseedMessage,
    syncing,
    syncMessage,
    backfilling,
    backfillMessage,
    wikiDisabled,
    togglingWiki,
  } = state;

  const [loadFailed, setLoadFailed] = useState(false);

  const fetchPages = useCallback(async () => {
    try {
      const res = await fetch("/api/wiki");
      if (!res.ok) throw new Error("Failed to load");
      dispatch({ type: "SET_PAGES", pages: await res.json() });
      dispatch({ type: "SET_ERROR", value: "" });
      setLoadFailed(false);
    } catch (e) {
      setLoadFailed(true);
      dispatch({
        type: "SET_ERROR",
        value: e instanceof Error ? e.message : "Failed to load wiki pages",
      });
    } finally {
      dispatch({ type: "SET_LOADING", value: false });
    }
  }, [dispatch]);

  const fetchWikiToggle = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/wiki/toggle");
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_WIKI_DISABLED", value: data.wikiDisabled });
      }
    } catch {
      // Non-critical — default to enabled
    }
  }, [dispatch]);

  useEffect(() => {
    fetchPages();
    if (isAdmin) fetchWikiToggle();
  }, [fetchPages, fetchWikiToggle, isAdmin]);

  const handleToggleWiki = async () => {
    dispatch({ type: "SET_TOGGLING_WIKI", value: true });
    try {
      const res = await fetch("/api/admin/wiki/toggle", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle");
      dispatch({ type: "SET_WIKI_DISABLED", value: data.wikiDisabled });
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        value: e instanceof Error ? e.message : "Failed to toggle wiki",
      });
    } finally {
      dispatch({ type: "SET_TOGGLING_WIKI", value: false });
    }
  };

  const resetForm = () => dispatch({ type: "RESET_FORM" });

  const startCreate = () => dispatch({ type: "START_CREATE" });

  const startEdit = (page: WikiPageRow) => {
    dispatch({
      type: "START_EDIT",
      snapshot: {
        slug: page.slug,
        title: page.dbPage.title,
        description: page.dbPage.description,
        content: page.dbPage.content,
        featured: page.dbPage.featured ?? false,
      },
    });
  };

  const formatReseedResult = (data: ReseedResult) => {
    const parts: string[] = [];
    if (data.inserted?.length) parts.push(`inserted ${data.inserted.length}`);
    if (data.updated?.length) parts.push(`updated ${data.updated.length}`);
    if (data.skipped?.length) {
      parts.push(
        `skipped ${data.skipped.length}: ${data.skipped.map((s) => `${s.slug} (${s.reason})`).join("; ")}`
      );
    }
    return parts.join(" · ") || "No changes";
  };

  const formatSyncResult = (data: SyncPriorResult) => {
    const parts: string[] = [];
    if (data.renamed?.length) parts.push(`renamed ${data.renamed.length}`);
    if (data.skipped?.length) parts.push(`skipped ${data.skipped.length}`);
    return parts.join(" · ") || "No legacy slugs found";
  };

  const handleSyncPriorSubmissions = async () => {
    if (
      !confirm(
        "Sync prior submissions will rename legacy ObjectId-based wiki slugs (player-/corp-/party-profile-) to use public sequential IDs. Continue?"
      )
    ) {
      return;
    }
    dispatch({ type: "SET_SYNCING", value: true });
    dispatch({ type: "SET_SYNC_MESSAGE", value: "" });
    dispatch({ type: "SET_ERROR", value: "" });
    try {
      const res = await fetch("/api/admin/wiki/sync-prior-submissions", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      dispatch({
        type: "SET_SYNC_MESSAGE",
        value: `Sync prior submissions: ${formatSyncResult(data)}`,
      });
      await fetchPages();
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        value: e instanceof Error ? e.message : "Sync failed",
      });
    } finally {
      dispatch({ type: "SET_SYNCING", value: false });
    }
  };

  const handleBackfillGameStamp = async () => {
    if (
      !confirm(
        "Stamp the current GAME_ITERATION and GAME_START_DATE onto all untagged user-created wiki pages. Seeded and auto-generated pages are excluded. Continue?"
      )
    ) {
      return;
    }
    dispatch({ type: "SET_BACKFILLING", value: true });
    dispatch({ type: "SET_BACKFILL_MESSAGE", value: "" });
    dispatch({ type: "SET_ERROR", value: "" });
    try {
      const res = await fetch("/api/admin/wiki/backfill-game-stamp", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Backfill failed");
      if (data.skippedNoEnv) {
        dispatch({
          type: "SET_BACKFILL_MESSAGE",
          value: "No env vars set — GAME_ITERATION and GAME_START_DATE are both missing.",
        });
      } else {
        dispatch({
          type: "SET_BACKFILL_MESSAGE",
          value: `Game stamp backfill: stamped ${data.stamped} page${data.stamped !== 1 ? "s" : ""}`,
        });
      }
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        value: e instanceof Error ? e.message : "Backfill failed",
      });
    } finally {
      dispatch({ type: "SET_BACKFILLING", value: false });
    }
  };

  const handleReseed = async (force: boolean) => {
    if (force) {
      if (!confirm("Force reseed will OVERWRITE any admin edits on seed-owned pages. Continue?")) {
        return;
      }
    }
    dispatch({ type: "SET_RESEED_MODE", value: force ? "force" : "reseed" });
    dispatch({ type: "SET_RESEED_MESSAGE", value: "" });
    dispatch({ type: "SET_ERROR", value: "" });
    try {
      const res = await fetch("/api/admin/wiki/reseed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reseed failed");
      dispatch({
        type: "SET_RESEED_MESSAGE",
        value: `${force ? "Force reseed" : "Reseed"}: ${formatReseedResult(data)}`,
      });
      await fetchPages();
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        value: e instanceof Error ? e.message : "Reseed failed",
      });
    } finally {
      dispatch({ type: "SET_RESEED_MODE", value: "" });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({ type: "SET_SAVING", value: true });
    try {
      const res = await fetch("/api/admin/wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: formSlug.trim(),
          title: formTitle.trim(),
          description: formDescription.trim(),
          content: formContent.trim(),
          featured: formFeatured,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      await fetchPages();
      resetForm();
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        value: e instanceof Error ? e.message : "Failed to create",
      });
    } finally {
      dispatch({ type: "SET_SAVING", value: false });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSlug) return;
    dispatch({ type: "SET_SAVING", value: true });
    try {
      const res = await fetch(`/api/admin/wiki/${encodeURIComponent(editingSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDescription.trim(),
          content: formContent.trim(),
          featured: formFeatured,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      await fetchPages();
      resetForm();
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        value: e instanceof Error ? e.message : "Failed to update",
      });
    } finally {
      dispatch({ type: "SET_SAVING", value: false });
    }
  };

  const handleDelete = async (slug: string) => {
    if (!confirm(`Delete wiki page "${slug}"?`)) return;
    try {
      const res = await fetch(`/api/admin/wiki/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      await fetchPages();
      if (editingSlug === slug) resetForm();
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        value: e instanceof Error ? e.message : "Failed to delete",
      });
    }
  };

  const dbPages: WikiPageRow[] = pages
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      dbPage: {
        slug: p.slug,
        title: p.title,
        description: p.description,
        content: p.content,
        featured: p.featured,
      },
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="space-y-8">
      {isAdmin && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-foreground">Wiki Access</h3>
            <p className="text-xs text-muted">
              {wikiDisabled
                ? "Wiki is disabled — non-admin users are redirected away from /wiki"
                : "Wiki is enabled — all users can access wiki pages"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleWiki}
            disabled={togglingWiki}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 ${
              wikiDisabled ? "bg-muted" : "bg-primary"
            }`}
            role="switch"
            aria-checked={!wikiDisabled}
            aria-label="Toggle wiki access"
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${
                wikiDisabled ? "translate-x-0" : "translate-x-5"
              }`}
            />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSyncPriorSubmissions}
          disabled={syncing}
          className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync prior submissions"}
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={handleBackfillGameStamp}
            disabled={backfilling}
            className="rounded-lg border border-secondary/40 bg-secondary/10 px-4 py-2 text-sm font-medium text-secondary hover:bg-secondary/20 disabled:opacity-50"
          >
            {backfilling ? "Backfilling…" : "Backfill game stamp"}
          </button>
        )}
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={() => handleReseed(false)}
              disabled={!!reseedMode}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {reseedMode === "reseed" ? "Reseeding…" : "Reseed wiki"}
            </button>
            <button
              type="button"
              onClick={() => handleReseed(true)}
              disabled={!!reseedMode}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              {reseedMode === "force" ? "Force reseeding…" : "Force reseed"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={startCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create Page
        </button>
      </div>

      {reseedMessage && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200">
          {reseedMessage}
        </div>
      )}

      {syncMessage && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
          {syncMessage}
        </div>
      )}

      {backfillMessage && (
        <div className="rounded-lg border border-secondary/30 bg-secondary/10 px-4 py-3 text-sm text-secondary">
          {backfillMessage}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-400">
          {error}
        </div>
      )}

      {(creating || editingSlug) && (
        <WikiPageForm
          mode={creating ? "create" : "edit"}
          slug={formSlug}
          title={formTitle}
          description={formDescription}
          content={formContent}
          featured={formFeatured}
          slugDisabled={!!editingSlug}
          onSlugChange={(value) => dispatch({ type: "SET_FORM_SLUG", value })}
          onTitleChange={(value) => dispatch({ type: "SET_FORM_TITLE", value })}
          onDescriptionChange={(value) => dispatch({ type: "SET_FORM_DESCRIPTION", value })}
          onContentChange={(value) => dispatch({ type: "SET_FORM_CONTENT", value })}
          onFeaturedChange={(value) => dispatch({ type: "SET_FORM_FEATURED", value })}
          onSubmit={creating ? handleCreate : handleUpdate}
          onCancel={resetForm}
          saving={saving}
        />
      )}

      <WikiPageTable
        dbPages={dbPages}
        loading={loading}
        loadFailed={loadFailed}
        onRetry={fetchPages}
        onEdit={startEdit}
        onDelete={handleDelete}
      />

      {isAdmin ? (
        <p className="text-sm text-muted">
          Wiki pages are stored in MongoDB. Use{" "}
          <strong className="text-foreground">Reseed wiki</strong> to insert/refresh seed-owned
          pages from <code className="rounded bg-card-elevated px-1">src/lib/seeds/wiki</code>{" "}
          without clobbering admin edits. Use{" "}
          <strong className="text-foreground">Force reseed</strong> to overwrite admin edits on
          seed-owned pages. Manually created pages are never touched by reseed.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Create, edit, and archive wiki pages. Reseed and wiki access controls are admin-only.
        </p>
      )}
    </div>
  );
}
