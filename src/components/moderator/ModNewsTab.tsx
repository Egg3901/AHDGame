"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { SerializedPost } from "../news/NewsPost";
import { LocalTime } from "@/components/time/LocalTime";

export function ModNewsTab() {
  const [posts, setPosts] = useState<SerializedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchPosts = useCallback(async (offset = 0, append = false) => {
    try {
      const url = new URL("/api/news", window.location.origin);
      url.searchParams.set("limit", "25");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("feed", "article");

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to load posts");
      const data = await res.json();
      const fetched: SerializedPost[] = data.posts;

      if (append) {
        setPosts((prev) => [...prev, ...fetched]);
      } else {
        setPosts(fetched);
      }
      setHasMore(fetched.length === 25);
      setError(null);
    } catch (_err) {
      setError("Failed to load posts. Please try again.");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPosts(0, false).finally(() => setLoading(false));
  }, [fetchPosts]);

  async function handleLoadMore() {
    setLoadingMore(true);
    await fetchPosts(posts.length, true);
    setLoadingMore(false);
  }

  async function handleDelete(postId: string) {
    if (!window.confirm("Are you sure you want to delete this post?")) return;

    setDeleting(postId);
    setActionError(null);
    try {
      const res = await fetch(`/api/moderator/news/${postId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete post");
      }
      setPosts((prev) => prev.filter((p) => p._id !== postId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete post");
    } finally {
      setDeleting(null);
    }
  }

  function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "…";
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-4">
        <h3 className="font-semibold text-foreground mb-2">News Moderation</h3>
        <p className="text-sm text-muted">{posts.length} posts loaded</p>
      </div>

      {actionError && (
        <div className="rounded-xl border border-error/30 bg-error/5 p-3 text-sm text-error">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-card-border bg-card p-4 animate-pulse">
              <div className="space-y-2">
                <div className="h-4 w-2/3 rounded bg-card-border" />
                <div className="h-3 w-full rounded bg-card-border" />
                <div className="h-3 w-1/2 rounded bg-card-border" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <p className="text-sm text-error">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              fetchPosts(0, false).finally(() => setLoading(false));
            }}
            className="mt-3 text-xs text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <p className="text-sm text-muted">No news posts to moderate.</p>
        </div>
      ) : (
        <>
          {posts.map((post) => (
            <div
              key={post._id}
              className="rounded-xl border border-card-border bg-card p-4 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <h4 className="font-semibold text-foreground truncate">
                      {post.title || "Untitled"}
                    </h4>
                    <span className="text-xs text-muted shrink-0">
                      by{" "}
                      <Link
                        href={`/character/${post.authorSequentialId ?? post.authorId}`}
                        className="text-primary hover:underline"
                      >
                        {post.authorName}
                      </Link>
                    </span>
                  </div>
                  <p className="text-sm text-muted mb-2">{truncateText(post.content, 200)}</p>
                  <p className="text-xs text-muted/60">
                    <LocalTime
                      value={post.createdAt}
                      options={{
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }}
                    />
                  </p>
                </div>

                <button
                  onClick={() => handleDelete(post._id)}
                  disabled={deleting === post._id}
                  className="px-3 py-2 rounded-lg bg-error/10 text-error text-sm font-medium hover:bg-error/20 disabled:opacity-50 transition-colors shrink-0 whitespace-nowrap"
                >
                  {deleting === post._id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full rounded-xl border border-card-border bg-card py-3 text-sm text-muted transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
