"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import type {
  BillDiscussionListResult,
  BillDiscussionView,
} from "@/lib/legislature/discussions/types";

interface BillDiscussionPanelProps {
  /** Bill base URL, e.g. `/api/congress/bills/123` or the regional bill base. */
  apiBase: string;
  /** Label used in the "only X members may post" hint, e.g. "Congress" / "Dáil". */
  chamberLabel: string;
}

const EMPTY: BillDiscussionListResult = {
  posts: [],
  page: 1,
  totalPages: 1,
  total: 0,
  viewerCanPost: false,
  viewerIsAdmin: false,
};

export function BillDiscussionPanel({ apiBase, chamberLabel }: BillDiscussionPanelProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<BillDiscussionListResult>(EMPTY);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      try {
        const res = await fetch(`${apiBase}/discussions?page=${targetPage}`);
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    },
    [apiBase]
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  async function submitPost() {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/discussions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error ?? "Could not post.");
        return;
      }
      setDraft("");
      if (page === 1) void load(1);
      else setPage(1);
    } finally {
      setSubmitting(false);
    }
  }

  async function react(post: BillDiscussionView, reaction: "agree" | "disagree") {
    const res = await fetch(`${apiBase}/discussions/${post._id}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    });
    if (res.ok) {
      const d = await res.json();
      setData((prev) => ({
        ...prev,
        posts: prev.posts.map((p) =>
          p._id === post._id
            ? { ...p, reactions: d.reactions, viewerReaction: d.viewerReaction }
            : p
        ),
      }));
    } else {
      const d = await res.json().catch(() => ({}));
      showToast(d.error ?? "Could not react.");
    }
  }

  async function remove(post: BillDiscussionView) {
    const res = await fetch(`${apiBase}/discussions/${post._id}`, { method: "DELETE" });
    if (res.ok) void load(page);
    else showToast("Could not remove post.");
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Discussion</h3>
        <span className="text-xs text-muted">
          {data.total} {data.total === 1 ? "post" : "posts"}
        </span>
      </div>

      {/* Composer */}
      {data.viewerCanPost ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Share your view on this bill…"
            className="w-full resize-y rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitPost}
              disabled={submitting || !draft.trim()}
              className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {submitting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Only {chamberLabel} members may post here.</p>
      )}

      {/* List */}
      {loading ? (
        <div className="min-h-[8rem] space-y-4 py-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : data.posts.length === 0 ? (
        <p className="text-xs text-muted py-2">No discussion yet.</p>
      ) : (
        <ul className="space-y-4">
          {data.posts.map((post) => (
            <li
              key={post._id}
              className="flex gap-3 border-t border-card-border/40 pt-4 first:border-0 first:pt-0"
            >
              <Avatar
                url={post.authorAvatarUrl}
                name={post.authorName}
                size="h-9 w-9"
                borderKey={post.authorBorderKey}
                tintColor={post.authorTintColor}
              />

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {post.authorSequentialId != null ? (
                      <Link
                        href={`/character/${post.authorSequentialId}`}
                        className="text-sm font-semibold hover:underline"
                        style={post.authorPartyColor ? { color: post.authorPartyColor } : undefined}
                      >
                        {post.authorName}
                      </Link>
                    ) : (
                      <span className="text-sm font-semibold">{post.authorName}</span>
                    )}
                    <p className="text-[11px] text-muted">
                      {[post.authorParty, post.authorRegionLabel].filter(Boolean).join(" · ") ||
                        "Independent"}
                    </p>
                  </div>
                  {data.viewerIsAdmin && (
                    <button
                      type="button"
                      onClick={() => remove(post)}
                      title="Remove post"
                      className="shrink-0 rounded-md border border-red-500/30 px-1.5 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <p className="whitespace-pre-wrap text-sm text-foreground/90">{post.content}</p>

                <div className="flex items-center gap-4 pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => react(post, "agree")}
                    title="Agree"
                    className={`flex items-center gap-1.5 transition-colors ${
                      post.viewerReaction === "agree"
                        ? "text-green-500"
                        : "text-muted hover:text-green-500"
                    }`}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                      />
                    </svg>
                    <span>{post.reactions.agree}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => react(post, "disagree")}
                    title="Disagree"
                    className={`flex items-center gap-1.5 transition-colors ${
                      post.viewerReaction === "disagree"
                        ? "text-red-500"
                        : "text-muted hover:text-red-500"
                    }`}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
                      />
                    </svg>
                    <span>{post.reactions.disagree}</span>
                  </button>
                  <span className="text-muted/60">
                    {new Date(post.createdAt).toLocaleString("en-US")}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2 text-xs">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={data.page <= 1}
            className="rounded-md border border-card-border px-3 py-1 text-muted hover:text-foreground disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-muted">
            Page {data.page} of {data.totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={data.page >= data.totalPages}
            className="rounded-md border border-card-border px-3 py-1 text-muted hover:text-foreground disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
