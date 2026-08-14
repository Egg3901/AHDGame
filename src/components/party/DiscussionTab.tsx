"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CardSkeleton, Skeleton } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MAX_CONTENT = 1000;
const PAGE_SIZE = 20;

interface DiscussionPost {
  id: string;
  authorName: string | null;
  content: string | null;
  createdAt: string;
  deleted: boolean;
}

interface DiscussionTabProps {
  /** Base API path, e.g. /api/country/us/parties/1/discussion */
  apiBasePath: string;
  isModerator: boolean;
}

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function PostContent({ content }: { content: string }) {
  return (
    <div className="prose-sm prose-invert max-w-none text-sm text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="rounded bg-card-elevated px-1 py-0.5 font-mono text-xs">
              {children}
            </code>
          ),
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function DiscussionTab({ apiBasePath, isModerator }: DiscussionTabProps) {
  const [posts, setPosts] = useState<DiscussionPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchPosts = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await fetch(`${apiBasePath}?page=${p}`);
        if (!res.ok) return;
        const data = await res.json();
        setPosts(data.posts ?? []);
        setTotal(data.total ?? 0);
        setPage(data.page ?? p);
        const rem = data.cooldownRemaining ?? 0;
        setCooldownRemaining(rem);
      } finally {
        setLoading(false);
      }
    },
    [apiBasePath]
  );

  useEffect(() => {
    fetchPosts(1);
  }, [fetchPosts]);

  // Live countdown for cooldown
  useEffect(() => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    if (cooldownRemaining <= 0) return;
    cooldownRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [cooldownRemaining]);

  const handleSubmit = async () => {
    if (!content.trim() || submitLoading || cooldownRemaining > 0) return;
    setSubmitLoading(true);
    setMessage("");
    try {
      const res = await fetch(apiBasePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Failed to post.");
        if (data.retryAfter) setCooldownRemaining(data.retryAfter);
        return;
      }
      setContent("");
      setMessage("✓ Posted.");
      await fetchPosts(1);
    } catch {
      setMessage("Network error.");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async (postId: string) => {
    if (!confirm("Delete this post?")) return;
    setDeletingId(postId);
    try {
      const res = await fetch(`${apiBasePath}/${postId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error ?? "Failed to delete.");
        return;
      }
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, deleted: true, authorName: null, content: null } : p
        )
      );
    } catch {
      setMessage("Network error.");
    } finally {
      setDeletingId(null);
    }
  };

  const isOverLimit = content.length > MAX_CONTENT;
  const canPost = content.trim().length > 0 && !isOverLimit && cooldownRemaining <= 0;

  return (
    <div className="space-y-4">
      {/* Compose */}
      <div className="rounded-xl border border-card-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">New Post</h3>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your post… (Markdown supported)"
          className="w-full resize-none rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          rows={4}
          disabled={submitLoading || cooldownRemaining > 0}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={`text-xs ${isOverLimit ? "text-red-400" : "text-muted"}`}>
            {content.length}/{MAX_CONTENT}
          </span>
          <div className="flex items-center gap-3">
            {cooldownRemaining > 0 && (
              <span className="text-xs text-muted">
                Next post in {formatCooldown(cooldownRemaining)}
              </span>
            )}
            {message && (
              <span
                className={`text-xs ${message.startsWith("✓") ? "text-green-400" : "text-red-400"}`}
              >
                {message}
              </span>
            )}
            <button
              onClick={handleSubmit}
              disabled={!canPost || submitLoading}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitLoading ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      </div>

      {/* Posts */}
      <div className="space-y-3">
        {loading ? (
          <div className="min-h-[18rem] space-y-3">
            {[1, 2, 3].map((i) => (
              <CardSkeleton key={i} className="!p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-2/3" />
              </CardSkeleton>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted italic">
            No posts yet. Be the first to start the discussion.
          </div>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="rounded-xl border border-card-border bg-card p-4">
              {post.deleted ? (
                <p className="text-xs italic text-muted">[Post removed by moderator]</p>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{post.authorName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">
                        <LocalTime value={post.createdAt} />
                      </span>
                      {isModerator && (
                        <button
                          onClick={() => handleDelete(post.id)}
                          disabled={deletingId === post.id}
                          className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {deletingId === post.id ? "…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </div>
                  <PostContent content={post.content!} />
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => fetchPosts(page - 1)}
            disabled={page <= 1 || loading}
            className="rounded px-3 py-1 text-sm text-muted hover:text-foreground disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-xs text-muted">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => fetchPosts(page + 1)}
            disabled={page >= totalPages || loading}
            className="rounded px-3 py-1 text-sm text-muted hover:text-foreground disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
