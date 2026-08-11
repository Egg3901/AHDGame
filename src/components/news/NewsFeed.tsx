"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { NewsPost, type SerializedPost } from "./NewsPost";

interface NewsFeedProps {
  feed: "article" | "advertisement";
  currentUser: {
    name: string;
    avatarUrl?: string | null;
  } | null;
  /** Character _id of the signed-in viewer, used to surface the author-only Edit affordance. */
  currentCharacterId?: string | null;
  authorId?: string | null;
  initialPosts?: SerializedPost[];
  registerOnPost?: (fn: (post: SerializedPost) => void) => void;
  moderationApiBase?: "/api/admin" | "/api/moderator" | null;
}

export function NewsFeed({
  feed,
  currentUser,
  currentCharacterId = null,
  authorId,
  initialPosts,
  registerOnPost,
  moderationApiBase = null,
}: NewsFeedProps) {
  const [posts, setPosts] = useState<SerializedPost[]>(initialPosts ?? []);
  const [loading, setLoading] = useState(!initialPosts);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialPosts ? initialPosts.length === 20 : true);
  const [error, setError] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState<string | null>(null);
  const [authorSequentialId, setAuthorSequentialId] = useState<number | null>(null);

  const fetchPosts = useCallback(
    async (offset = 0, append = false) => {
      try {
        const url = new URL("/api/news", window.location.origin);
        url.searchParams.set("limit", "20");
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("feed", feed);
        if (authorId) url.searchParams.set("authorId", authorId);

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error("Failed to load posts");
        const data = await res.json();
        const fetched: SerializedPost[] = data.posts;
        if (append) {
          setPosts((prev) => [...prev, ...fetched]);
        } else {
          setPosts(fetched);
          if (authorId && fetched.length > 0) {
            setAuthorName(fetched[0].authorName);
            setAuthorSequentialId(fetched[0].authorSequentialId ?? null);
          }
        }
        setHasMore(fetched.length === 20);
      } catch {
        setError("Failed to load posts. Please try again.");
      }
    },
    [authorId, feed]
  );

  useEffect(() => {
    if (initialPosts && feed === "article") {
      // initialPosts were server-rendered; restore them when returning from another feed.
      setPosts(initialPosts);
      setHasMore(initialPosts.length === 20);
      setError(null);
      setAuthorName(initialPosts[0]?.authorName ?? null);
      setAuthorSequentialId(initialPosts[0]?.authorSequentialId ?? null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setPosts([]);
    setAuthorName(null);
    setAuthorSequentialId(null);
    fetchPosts(0, false).finally(() => setLoading(false));
  }, [fetchPosts, initialPosts, feed]);

  async function handleLoadMore() {
    setLoadingMore(true);
    await fetchPosts(posts.length, true);
    setLoadingMore(false);
  }

  const handleNewPost = useCallback(
    (post: SerializedPost) => {
      const kind = post.feedType ?? "article";
      if (kind !== feed) return;
      setPosts((prev) => [post, ...prev]);
    },
    [feed]
  );

  const handleModerationRemove = useCallback((postId: string) => {
    setPosts((prev) => prev.filter((p) => p._id !== postId));
  }, []);

  // Register the new-post handler so the page-level modal composer can inject posts
  useEffect(() => {
    registerOnPost?.(handleNewPost);
  }, [registerOnPost, handleNewPost]);

  function handleReactionChange(
    postId: string,
    reactions: { agree: number; disagree: number },
    userReaction: "agree" | "disagree" | null
  ) {
    setPosts((prev) => prev.map((p) => (p._id === postId ? { ...p, reactions, userReaction } : p)));
  }

  function handlePostEdited(
    postId: string,
    patch: {
      title: string | null;
      content: string;
      imageUrl: string | null;
      editedAt: string | null;
    }
  ) {
    setPosts((prev) => prev.map((p) => (p._id === postId ? { ...p, ...patch } : p)));
  }

  return (
    <div className="space-y-4">
      {/* Author filter banner */}
      {authorId && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <svg
              className="h-4 w-4 text-primary shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
            <span className="text-muted">
              Showing posts by{" "}
              {authorName ? (
                <Link
                  href={`/character/${authorSequentialId ?? authorId}`}
                  className="font-medium text-foreground hover:text-primary transition-colors"
                >
                  {authorName}
                </Link>
              ) : (
                <span className="font-medium text-foreground">this politician</span>
              )}
            </span>
          </div>
          <Link href="/news" className="text-xs text-muted hover:text-foreground transition-colors">
            Clear filter ×
          </Link>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-card-border bg-card p-4 animate-pulse">
              <div className="flex gap-3 mb-3">
                <div className="h-9 w-9 rounded-full bg-card-border shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 rounded bg-card-border" />
                  <div className="h-2.5 w-20 rounded bg-card-border" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full rounded bg-card-border" />
                <div className="h-3 w-4/5 rounded bg-card-border" />
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
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <p className="font-medium text-foreground">No posts yet</p>
          <p className="mt-1 text-sm text-muted">
            {authorId
              ? feed === "advertisement"
                ? "This politician has no sponsored posts yet."
                : "This politician hasn't posted anything yet."
              : currentUser
                ? feed === "advertisement"
                  ? "No sponsored posts yet — use “Place ad” in the banner."
                  : "Be the first to post — use “Post news” in the banner."
                : feed === "advertisement"
                  ? "Sign in to place a sponsored post."
                  : "Sign in with a character to post updates."}
          </p>
        </div>
      ) : (
        <>
          {posts.map((post) => (
            <NewsPost
              key={post._id}
              post={post}
              canInteract={!!currentUser}
              currentCharacterId={currentCharacterId}
              moderationApiBase={moderationApiBase}
              onReactionChange={handleReactionChange}
              onModerationRemove={handleModerationRemove}
              onPostEdited={handlePostEdited}
            />
          ))}

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full rounded-xl border border-card-border bg-card py-3 text-sm text-muted transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
