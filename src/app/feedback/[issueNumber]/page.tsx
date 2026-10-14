"use client";

import { InlineError } from "@/components/ui/InlineError";
import { apiErrorText } from "@/lib/errors/catalog";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Card, CardSkeleton, SectionLabel, Skeleton } from "@/components/ui";
import { CategoryBadge } from "@/components/suggestions/CategoryBadge";
import { StatusBadge } from "@/components/suggestions/StatusBadge";
import { ForumPost, type ForumAuthor } from "@/components/suggestions/ForumPost";
import { SuggestionVotes } from "@/components/suggestions/SuggestionVotes";
import { SuggestionReportButton } from "@/components/suggestions/SuggestionReportButton";
import { DiscordDiscussLink } from "@/components/suggestions/DiscordDiscussLink";
import { SUGGESTION_CATEGORY_LABELS } from "@/components/FeedbackModal/constants";
import { LocalTime, RelativeTime } from "@/components/time/LocalTime";
import type { CountryId } from "@/lib/constants/countries";

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
  discordUrl: string | null;
  commentCount: number;
  reactions: { like: number; dislike: number };
  userReaction: "like" | "dislike" | null;
  reporterCharacterId: string | null;
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
  authorCharacterId: string | null;
  authorPartyAbbrev: string | null;
  authorStateCode: string | null;
  authorCountryId: string | null;
  body: string;
  createdAt: string;
  userId: string;
}

interface Viewer {
  id: string;
  characterId: string | null;
  isAdmin: boolean;
  hasCharacter: boolean;
}

const COMMENTS_PAGE = 20;

export default function FeedbackDetailPage() {
  const params = useParams();
  const issueNum = parseInt(params.issueNumber as string, 10);
  // The Discord post links to `?report=1`.
  const [openReport, setOpenReport] = useState(false);

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
  // undefined = still loading, null = logged out
  const [viewer, setViewer] = useState<Viewer | null | undefined>(undefined);

  const loadDetail = useCallback(async () => {
    if (isNaN(issueNum) || issueNum < 1) {
      setError("Invalid suggestion");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/suggestions/public/${issueNum}`);
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorText(data, "Not found"));
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

  // Forum order: oldest reply first, composer at the bottom.
  const loadComments = useCallback(
    async (page: number, append = false) => {
      try {
        const res = await fetch(
          `/api/suggestions/public/${issueNum}/comments?page=${page}&limit=${COMMENTS_PAGE}&order=asc`
        );
        const data = await res.json();
        if (!res.ok) return;
        setComments((prev) =>
          append ? [...prev, ...(data.comments ?? [])] : (data.comments ?? [])
        );
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenReport(new URLSearchParams(window.location.search).get("report") === "1");
  }, []);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        setViewer(
          res.ok && data?.user
            ? {
                id: data.user.id,
                characterId: data.user.character?.id ?? null,
                isAdmin: data.user.isAdmin === true,
                hasCharacter: data.user.hasCharacter === true,
              }
            : null
        );
      } catch {
        setViewer(null);
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
        setPostError(apiErrorText(data, "Failed to post"));
        return;
      }
      setCommentBody("");
      if (data.comment && !hasMoreComments) {
        setComments((prev) => [...prev, data.comment]);
        setCommentsTotal((n) => n + 1);
      } else {
        setCommentsPage(1);
        void loadComments(1);
      }
    } catch {
      setPostError("Network error");
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment(commentId: string) {
    try {
      const res = await fetch(`/api/suggestions/public/${issueNum}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c._id !== commentId));
        setCommentsTotal((prev) => prev - 1);
      }
    } catch {
      /* ignore */
    }
  }

  async function handleStatusChange(newStatus: string) {
    try {
      const res = await fetch(`/api/admin/suggestions/${issueNum}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setDetail((prev) => (prev ? { ...prev, status: newStatus } : prev));
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <div className="mx-auto min-h-[70vh] max-w-4xl space-y-5 px-4 py-8">
        <Skeleton className="h-4 w-48" />
        <CardSkeleton>
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-5 w-48" />
          </div>
        </CardSkeleton>
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-error">{error || "Not found"}</p>
        <Link href="/feedback" className="mt-4 inline-block text-primary hover:underline">
          Back to suggestions
        </Link>
      </div>
    );
  }

  const isMerged = !!detail.mergedIntoLink;
  const isAdmin = viewer?.isAdmin === true;
  const categoryLabel =
    SUGGESTION_CATEGORY_LABELS[detail.category as keyof typeof SUGGESTION_CATEGORY_LABELS] ??
    detail.category;
  const opAuthor: ForumAuthor = {
    name: detail.reporterCharacterName ?? detail.reporterUsername,
    avatarUrl: detail.reporterAvatarUrl,
    characterId: detail.reporterCharacterId,
    partyAbbrev: detail.reporterPartyAbbrev,
    stateCode: detail.reporterStateCode,
    countryId: detail.reporterCountryId,
  };
  const ownsSuggestion = !!viewer?.characterId && viewer.characterId === detail.reporterCharacterId;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1.5 text-xs text-muted"
      >
        <Link href="/feedback" className="font-medium hover:text-foreground">
          Suggestions
        </Link>
        <span aria-hidden>/</span>
        <Link
          href={`/feedback?category=${encodeURIComponent(detail.category)}`}
          className="hover:text-foreground"
        >
          {categoryLabel}
        </Link>
        <span aria-hidden>/</span>
        <span className="font-mono text-foreground/80">S#{detail.issueNumber}</span>
      </nav>

      {/* Thread header */}
      <header className="mt-3 overflow-hidden rounded-2xl border border-card-border bg-gradient-to-br from-card-elevated via-card to-card shadow-lg">
        <div className="flex flex-col items-start justify-between gap-4 px-5 py-5 sm:flex-row sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={detail.status}
                onChange={isAdmin ? handleStatusChange : undefined}
              />
              <CategoryBadge
                category={detail.category as "feature_request"}
                gameSystem={detail.gameSystem as "elections"}
              />
            </div>
            <h1 className="mt-2.5 text-2xl font-bold leading-tight text-foreground sm:text-[1.75rem]">
              {detail.title}
            </h1>
          </div>
          {detail.discordUrl && <DiscordDiscussLink href={detail.discordUrl} />}
        </div>
        <dl className="grid grid-cols-3 divide-x divide-card-border border-t border-card-border bg-card-muted/60 text-center">
          <div className="px-3 py-2.5">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Votes</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              <span className="text-success">{detail.reactions.like}</span>
              <span className="mx-1 text-muted">/</span>
              <span className="text-error">{detail.reactions.dislike}</span>
            </dd>
          </div>
          <div className="px-3 py-2.5">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Replies</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {commentsTotal}
            </dd>
          </div>
          <div className="px-3 py-2.5">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Posted</dt>
            <dd className="mt-0.5 text-sm font-semibold text-foreground">
              <LocalTime
                value={detail.createdAt}
                options={{ month: "short", day: "numeric", year: "numeric" }}
              />
            </dd>
          </div>
        </dl>
      </header>

      {detail.mergedIntoLink && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground">
          Merged into{" "}
          <Link
            href={`/feedback/${detail.mergedIntoLink.issueNumber}`}
            className="font-semibold text-primary hover:underline"
          >
            S#{detail.mergedIntoLink.issueNumber}: {detail.mergedIntoLink.title}
          </Link>
          . Vote and reply there.
        </div>
      )}

      {detail.mergedFromLinks.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-3">
          <span className="text-xs font-medium text-muted">Merged from</span>
          {detail.mergedFromLinks.map((link) => (
            <Link
              key={link.issueNumber}
              href={`/feedback/${link.issueNumber}`}
              className="rounded-md border border-card-border bg-card-elevated px-2 py-0.5 text-xs text-primary hover:underline"
            >
              S#{link.issueNumber}: {link.title}
            </Link>
          ))}
        </div>
      )}

      {/* Original post */}
      <div className="mt-5">
        <ForumPost
          emphasis
          author={opAuthor}
          role="Original poster"
          meta={
            <>
              <span className="font-mono">S#{detail.issueNumber}</span>
              <span aria-hidden>·</span>
              <RelativeTime value={detail.createdAt} />
            </>
          }
          footer={
            <>
              <SuggestionVotes
                issueNumber={detail.issueNumber}
                reactions={detail.reactions}
                userReaction={detail.userReaction}
                disabled={isMerged}
                size="md"
              />
              <div className="flex items-center gap-1">
                {detail.githubIssueUrl && (
                  <a
                    href={detail.githubIssueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-card-elevated hover:text-foreground"
                  >
                    GitHub issue
                  </a>
                )}
                {detail.reporterCharacterId && !ownsSuggestion && (
                  <SuggestionReportButton
                    key={String(openReport)}
                    issueNumber={detail.issueNumber}
                    initiallyOpen={openReport}
                  />
                )}
              </div>
            </>
          }
        >
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
            {detail.description}
          </p>
          {detail.screenshotUrl && (
            <div className="mt-4 overflow-hidden rounded-lg border border-card-border bg-card-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={detail.screenshotUrl}
                alt="Screenshot attached to this suggestion"
                className="max-h-[min(70vh,560px)] w-full object-contain"
              />
            </div>
          )}
          {(detail.impact || detail.priority != null) && (
            <div className="mt-4 space-y-2 rounded-lg border border-card-border bg-card-muted px-4 py-3">
              {detail.impact && (
                <div>
                  <p className="text-xs font-semibold text-muted">Expected impact</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                    {detail.impact}
                  </p>
                </div>
              )}
              {detail.priority != null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted">Priority to the poster</span>
                  <span
                    className="flex items-center gap-0.5"
                    aria-label={`${detail.priority} of 5`}
                  >
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span
                        key={i}
                        className={`h-2 w-2 rounded-full ${i <= detail.priority! ? "bg-primary" : "bg-card-border"}`}
                      />
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}
        </ForumPost>
      </div>

      {/* Replies */}
      <section className="mt-8" aria-label="Replies">
        <SectionLabel>
          {commentsTotal} {commentsTotal === 1 ? "reply" : "replies"}
        </SectionLabel>

        <div className="space-y-3">
          {comments.map((c, index) => {
            const own = viewer?.id === c.userId;
            return (
              <ForumPost
                key={c._id}
                id={`reply-${c._id}`}
                author={{
                  name: c.authorName,
                  avatarUrl: c.authorAvatarUrl,
                  characterId: c.authorCharacterId,
                  partyAbbrev: c.authorPartyAbbrev,
                  stateCode: c.authorStateCode,
                  countryId: c.authorCountryId as CountryId | null,
                }}
                role={
                  c.authorCharacterId && c.authorCharacterId === detail.reporterCharacterId
                    ? "Poster"
                    : undefined
                }
                meta={
                  <>
                    <a href={`#reply-${c._id}`} className="font-mono hover:text-foreground">
                      #{index + 1}
                    </a>
                    <span aria-hidden>·</span>
                    <RelativeTime value={c.createdAt} />
                  </>
                }
                headerAction={
                  <div className="flex items-center gap-1">
                    {(isAdmin || own) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Delete this reply?")) void deleteComment(c._id);
                        }}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-error/10 hover:text-error"
                      >
                        Delete
                      </button>
                    )}
                    {!own && c.authorCharacterId && (
                      <SuggestionReportButton issueNumber={detail.issueNumber} commentId={c._id} />
                    )}
                  </div>
                }
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {c.body}
                </p>
              </ForumPost>
            );
          })}
        </div>

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
              Load more replies
            </Button>
          </div>
        )}

        {commentsTotal === 0 && (
          <p className="rounded-xl border border-dashed border-card-border px-4 py-6 text-center text-sm text-muted">
            No replies yet.
          </p>
        )}

        {/* Composer */}
        {!isMerged && (
          <Card className="mt-5 shadow-md" title="Post a reply">
            {viewer === undefined ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : viewer === null ? (
              <p className="text-sm text-muted">
                <Link href="/login" className="font-semibold text-primary hover:underline">
                  Log in
                </Link>{" "}
                to vote and reply.
              </p>
            ) : !viewer.hasCharacter ? (
              <p className="text-sm text-muted">
                Replies are posted as your character.{" "}
                <Link
                  href="/create-character"
                  className="font-semibold text-primary hover:underline"
                >
                  Create a character
                </Link>{" "}
                to join the thread.
              </p>
            ) : (
              <form onSubmit={submitComment} className="space-y-3">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value.slice(0, 2000))}
                  rows={4}
                  maxLength={2000}
                  className="w-full rounded-lg border border-card-border bg-card-muted px-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Add to the discussion"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      isLoading={posting}
                      disabled={!commentBody.trim()}
                      className="px-4 py-1.5 text-sm"
                    >
                      Post reply
                    </Button>
                    <InlineError error={postError} className="text-sm text-error" />
                  </div>
                  <span className="text-xs tabular-nums text-muted">{commentBody.length}/2000</span>
                </div>
              </form>
            )}
            {detail.discordUrl && (
              <p className="mt-3 border-t border-card-border pt-3 text-xs text-muted">
                This suggestion is also posted in the Discord suggestions channel.{" "}
                <a
                  href={detail.discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary hover:underline"
                >
                  Join the discussion there
                </a>
                .
              </p>
            )}
          </Card>
        )}
      </section>
    </div>
  );
}
