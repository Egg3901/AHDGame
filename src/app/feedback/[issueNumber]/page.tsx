"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, CardSkeleton, Skeleton } from "@/components/ui";
import { CategoryBadge } from "@/components/suggestions/CategoryBadge";
import { CommentItem } from "@/components/suggestions/CommentItem";
import { PlayerBadge } from "@/components/suggestions/PlayerBadge";
import { StatusBadge } from "@/components/suggestions/StatusBadge";
import { getCountryFlagUrlForEra } from "@/lib/constants";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface Detail {
  issueNumber: number;
  title: string;
  description: string;
  category: string;
  gameSystem: string;
  status: string;
  impact: string | null;
  priority: number | null;
  screenshotUrl: string | null;
  githubIssueUrl: string | null;
  commentCount: number;
  reporterUsername: string | null;
  reporterDiscordUsername: string | null;
  reporterCharacterName: string | null;
  reporterAvatarUrl: string | null;
  reporterPartyAbbrev: string | null;
  reporterStateCode: string | null;
  reporterCountryId: CountryId | null;
  mergedIntoLink: { issueNumber: number; title: string } | null;
  mergedFromLinks: { issueNumber: number; title: string }[];
  createdAt: string;
}

interface CommentRow {
  _id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorParty: string | null;
  authorPartyAbbrev: string | null;
  authorStateCode: string | null;
  authorCountryId: string | null;
  authorBorderKey: string | null;
  authorTintColor: string | null;
  body: string;
  createdAt: string;
  userId: string;
}

export default function FeedbackDetailPage() {
  const preset = useActivePreset();
  const params = useParams();
  const raw = params.issueNumber as string;
  const issueNum = parseInt(raw, 10);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [commentsPage, setCommentsPage] = useState(1);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [_deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (isNaN(issueNum) || issueNum < 1) {
      setError("Invalid suggestion");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/suggestions/public/${issueNum}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Not found");
        setDetail(null);
        return;
      }
      setDetail(data);
    } catch {
      setError("Network error");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [issueNum]);

  const loadComments = useCallback(
    async (page: number, append = false) => {
      try {
        const res = await fetch(
          `/api/suggestions/public/${issueNum}/comments?page=${page}&limit=20`
        );
        const data = await res.json();
        if (!res.ok) return;
        if (append) {
          setComments((prev) => [...prev, ...(data.comments ?? [])]);
        } else {
          setComments(data.comments ?? []);
        }
        setCommentsTotal(data.total ?? 0);
        setHasMoreComments(data.hasMore ?? false);
      } catch {
        /* ignore */
      }
    },
    [issueNum]
  );

  useEffect(() => {
    void loadDetail();
    void loadComments(1);
  }, [loadDetail, loadComments]);

  // Check auth status
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (res.ok && data?.user) {
          setIsAdmin(data.user.isAdmin === true);
          setCurrentUserId(data.user.id ?? null);
        }
      } catch {
        /* ignore */
      }
    }
    void checkAuth();
  }, []);

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    setPostError("");
    setPosting(true);
    try {
      const res = await fetch(`/api/suggestions/public/${issueNum}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentBody }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPostError(data.error ?? "Failed to post");
        return;
      }
      setCommentBody("");
      // New comments go at the top (newest first), so prepend
      if (data.comment) {
        setComments((prev) => [data.comment, ...prev]);
      } else {
        void loadComments(1);
      }
      // Refresh detail to update comment count
      void loadDetail();
    } catch {
      setPostError("Network error");
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment(commentId: string) {
    setDeletingCommentId(commentId);
    try {
      const res = await fetch(`/api/suggestions/public/${issueNum}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c._id !== commentId));
        setCommentsTotal((prev) => prev - 1);
        void loadDetail();
      }
    } catch {
      /* ignore */
    } finally {
      setDeletingCommentId(null);
    }
  }

  async function handleStatusChange(newStatus: string) {
    try {
      const res = await fetch(`/api/admin/suggestions/${issueNum}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setDetail((prev) => (prev ? { ...prev, status: newStatus } : prev));
      }
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <div className="mx-auto min-h-[70vh] max-w-3xl px-4 py-8">
        <Skeleton className="h-9 w-32" />
        <div className="mt-4 flex items-start gap-3">
          <Skeleton className="mt-1 h-10 w-10 shrink-0 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-5 w-40 rounded-full" />
          </div>
        </div>
        <CardSkeleton className="mt-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </CardSkeleton>
        <div className="mt-10 space-y-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-error">{error || "Not found"}</p>
        <Link href="/feedback" className="mt-4 inline-block text-primary hover:underline">
          &larr; Back to suggestions
        </Link>
      </div>
    );
  }

  const countryCfg = detail.reporterCountryId ? getCountryConfig(detail.reporterCountryId) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/feedback"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-card-border text-sm font-medium text-foreground hover:bg-card-elevated transition-colors"
      >
        <svg
          className="w-3.5 h-3.5 text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Suggestions
      </Link>

      {/* Merged banner */}
      {detail.mergedIntoLink && (
        <div className="mt-4 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-300">
          This suggestion has been merged into{" "}
          <Link
            href={`/feedback/${detail.mergedIntoLink.issueNumber}`}
            className="font-medium text-primary hover:underline"
          >
            S#{detail.mergedIntoLink.issueNumber}: {detail.mergedIntoLink.title}
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {/* Reporter avatar */}
          {detail.reporterAvatarUrl ? (
            <div className="mt-1 h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-card-border">
              <Image
                src={detail.reporterAvatarUrl}
                alt=""
                width={40}
                height={40}
                className="h-full w-full object-cover"
                unoptimized={bypassNextImageOptimization(detail.reporterAvatarUrl)}
              />
            </div>
          ) : detail.reporterCharacterName ? (
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-elevated ring-1 ring-card-border text-sm font-medium text-muted">
              {detail.reporterCharacterName.charAt(0).toUpperCase()}
            </div>
          ) : null}

          <div>
            <p className="font-mono text-xs text-muted">S#{detail.issueNumber}</p>
            <h1 className="mt-0.5 text-2xl font-semibold text-foreground">{detail.title}</h1>

            {/* Category + game system badges */}
            <div className="mt-2">
              <CategoryBadge
                category={detail.category as "feature_request"}
                gameSystem={detail.gameSystem as "elections"}
              />
            </div>

            {/* Reporter info with party badge */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {detail.reporterCharacterName && (
                <span className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-foreground">
                  {detail.reporterCharacterName}
                </span>
              )}
              <PlayerBadge
                partyAbbrev={detail.reporterPartyAbbrev}
                stateCode={detail.reporterStateCode}
                countryId={detail.reporterCountryId}
                size="md"
              />
              {detail.reporterDiscordUsername && (
                <span className="rounded-md bg-indigo-500/15 px-2.5 py-1 text-xs text-indigo-300">
                  Discord: {detail.reporterDiscordUsername}
                </span>
              )}
              {countryCfg && (
                <Link
                  href={countryCfg.overviewPath}
                  className="inline-flex shrink-0 items-center opacity-90 transition-opacity hover:opacity-100"
                >
                  <Image
                    src={getCountryFlagUrlForEra(countryCfg.code, preset)}
                    alt={countryCfg.name}
                    width={22}
                    height={15}
                    className="h-3.5 w-auto max-h-3.5 rounded-sm object-cover ring-1 ring-card-border/50"
                    unoptimized={bypassNextImageOptimization(
                      getCountryFlagUrlForEra(countryCfg.code, preset)
                    )}
                  />
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Status badge — admin-clickable */}
        <StatusBadge status={detail.status} onChange={isAdmin ? handleStatusChange : undefined} />
      </div>

      {/* Merged-from links */}
      {detail.mergedFromLinks.length > 0 && (
        <div className="mt-4 rounded-lg border border-card-border bg-card-elevated px-4 py-3">
          <p className="text-xs font-medium text-muted mb-2">Merged from:</p>
          <div className="flex flex-wrap gap-2">
            {detail.mergedFromLinks.map((link) => (
              <Link
                key={link.issueNumber}
                href={`/feedback/${link.issueNumber}`}
                className="rounded-md border border-card-border bg-card px-2.5 py-1 text-xs text-primary hover:underline"
              >
                S#{link.issueNumber}: {link.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Screenshot */}
      {detail.screenshotUrl ? (
        <div className="mt-6 overflow-hidden rounded-xl border border-card-border bg-card-elevated shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={detail.screenshotUrl}
            alt="Screenshot attached to this suggestion"
            className="max-h-[min(70vh,560px)] w-full object-contain"
          />
        </div>
      ) : null}

      {/* Description */}
      <div className="mt-6 rounded-xl border border-card-border bg-card p-5">
        <p className="whitespace-pre-wrap text-sm text-foreground">{detail.description}</p>
        {detail.impact && (
          <div className="mt-4 border-t border-card-border pt-4">
            <p className="text-xs font-medium text-muted">Impact</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{detail.impact}</p>
          </div>
        )}
        {detail.priority != null && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted">Priority</span>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`h-2 w-2 rounded-full ${i <= detail.priority! ? "bg-primary" : "bg-card-border"}`}
                />
              ))}
            </div>
          </div>
        )}
        {detail.githubIssueUrl && (
          <a
            href={detail.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            GitHub issue
          </a>
        )}
      </div>

      {/* Comments */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Comments ({commentsTotal})</h2>

        {/* Comment form at top — for new comments */}
        <form onSubmit={submitComment} className="mt-4 space-y-3">
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value.slice(0, 2000))}
            rows={3}
            maxLength={2000}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Add a comment… (requires an active character)"
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              isLoading={posting}
              disabled={!commentBody.trim()}
              className="px-3 py-1.5 text-sm"
            >
              Post comment
            </Button>
            {postError && <p className="text-sm text-error">{postError}</p>}
          </div>
        </form>

        {/* Comment list — newest first */}
        <div className="mt-6 space-y-4">
          {comments.map((c) => (
            <CommentItem
              key={c._id}
              _id={c._id}
              authorName={c.authorName}
              authorAvatarUrl={c.authorAvatarUrl}
              authorParty={c.authorParty}
              authorPartyAbbrev={c.authorPartyAbbrev}
              authorStateCode={c.authorStateCode}
              authorCountryId={c.authorCountryId}
              authorBorderKey={c.authorBorderKey}
              authorTintColor={c.authorTintColor}
              body={c.body}
              createdAt={c.createdAt}
              userId={c.userId}
              canDelete={isAdmin || c.userId === currentUserId}
              onDelete={deleteComment}
            />
          ))}
        </div>

        {/* Load more */}
        {hasMoreComments && (
          <div className="mt-4 text-center">
            <Button
              variant="secondary"
              onClick={() => {
                const nextPage = commentsPage + 1;
                setCommentsPage(nextPage);
                void loadComments(nextPage, true);
              }}
              className="px-3 py-1.5 text-sm"
            >
              Load more comments
            </Button>
          </div>
        )}

        {commentsTotal === 0 && (
          <p className="mt-6 text-sm text-muted">No comments yet. Be the first to weigh in!</p>
        )}
      </section>
    </div>
  );
}
