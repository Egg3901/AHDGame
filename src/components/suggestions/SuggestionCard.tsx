"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { CategoryBadge } from "./CategoryBadge";
import { PlayerBadge } from "./PlayerBadge";
import { StatusBadge } from "./StatusBadge";
import type { CountryId } from "@/lib/constants/countries";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { formatStableUtc } from "@/lib/time/localTime";

interface SuggestionCardProps {
  id: string;
  issueNumber: number;
  category: string;
  gameSystem: string;
  title: string;
  descriptionPreview?: string;
  impactPreview?: string | null;
  status: string;
  screenshotUrl: string | null;
  commentCount: number;
  unreadCommentCount?: number;
  reactions?: { like: number; dislike: number };
  userReaction?: "like" | "dislike" | null;
  reporterCharacterName?: string | null;
  reporterAvatarUrl?: string | null;
  reporterPartyAbbrev?: string | null;
  reporterStateCode?: string | null;
  reporterCountryId?: CountryId | null;
  createdAt: string;
  mergedInto?: string | null;
  selected?: boolean;
  selectable?: boolean;
  onToggleSelect?: (id: string) => void;
}

function formatTime(iso: string) {
  // Deterministic (UTC) so SSR and client agree — avoids hydration error #418.
  return formatStableUtc(iso, { month: "short", day: "numeric", year: "numeric" });
}

export function SuggestionCard({
  id,
  issueNumber,
  category,
  gameSystem,
  title,
  descriptionPreview,
  impactPreview,
  status,
  screenshotUrl,
  commentCount,
  unreadCommentCount,
  reactions,
  userReaction,
  reporterCharacterName,
  reporterAvatarUrl,
  reporterPartyAbbrev,
  reporterStateCode,
  reporterCountryId,
  createdAt,
  mergedInto,
  selected,
  selectable,
  onToggleSelect,
}: SuggestionCardProps) {
  const isMerged = !!mergedInto;
  const [likeCount, setLikeCount] = useState(reactions?.like ?? 0);
  const [dislikeCount, setDislikeCount] = useState(reactions?.dislike ?? 0);
  const [myReaction, setMyReaction] = useState<"like" | "dislike" | null>(userReaction ?? null);
  const [reacting, setReacting] = useState(false);

  async function handleReact(e: React.MouseEvent, next: "like" | "dislike") {
    e.preventDefault();
    e.stopPropagation();
    if (reacting || isMerged) return;
    setReacting(true);
    const prev = { myReaction, likeCount, dislikeCount };
    let optLike = likeCount;
    let optDislike = dislikeCount;
    let optReaction: "like" | "dislike" | null;
    if (myReaction === next) {
      optReaction = null;
      if (next === "like") optLike -= 1;
      else optDislike -= 1;
    } else if (myReaction && myReaction !== next) {
      optReaction = next;
      if (next === "like") {
        optLike += 1;
        optDislike -= 1;
      } else {
        optDislike += 1;
        optLike -= 1;
      }
    } else {
      optReaction = next;
      if (next === "like") optLike += 1;
      else optDislike += 1;
    }
    setMyReaction(optReaction);
    setLikeCount(Math.max(0, optLike));
    setDislikeCount(Math.max(0, optDislike));

    try {
      const res = await fetch(`/api/suggestions/public/${issueNumber}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: next }),
      });
      if (!res.ok) {
        setMyReaction(prev.myReaction);
        setLikeCount(prev.likeCount);
        setDislikeCount(prev.dislikeCount);
        if (res.status === 401) {
          window.location.href = "/login";
        }
        return;
      }
      const data = await res.json();
      setMyReaction(data.userReaction ?? null);
      setLikeCount(data.reactions?.like ?? 0);
      setDislikeCount(data.reactions?.dislike ?? 0);
    } catch {
      setMyReaction(prev.myReaction);
      setLikeCount(prev.likeCount);
      setDislikeCount(prev.dislikeCount);
    } finally {
      setReacting(false);
    }
  }

  return (
    <div
      className={`flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm transition-colors ${
        isMerged
          ? "border-muted/30 opacity-60"
          : selected
            ? "border-primary ring-2 ring-primary/30"
            : "border-card-border hover:border-primary/40 hover:bg-background/40"
      }`}
    >
      <Link
        href={`/feedback/${issueNumber}`}
        className="flex h-full flex-col"
        onClick={
          selectable
            ? (e) => {
                if (selected) e.preventDefault();
              }
            : undefined
        }
      >
        {/* Top row: checkbox (admin) + reporter + status badge */}
        <div className="mb-2.5 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {selectable && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleSelect?.(id);
                }}
                className={`flex-shrink-0 flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-card-border bg-card-elevated hover:border-primary/40"
                }`}
                aria-label={selected ? "Deselect" : "Select"}
              >
                {selected && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l3 3 5-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            )}
            {reporterAvatarUrl ? (
              <div className="h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-card-border">
                <Image
                  src={reporterAvatarUrl}
                  alt=""
                  width={24}
                  height={24}
                  className="h-full w-full object-cover"
                  unoptimized={bypassNextImageOptimization(reporterAvatarUrl)}
                />
              </div>
            ) : reporterCharacterName ? (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card-elevated ring-1 ring-card-border text-[10px] font-medium text-muted">
                {reporterCharacterName.charAt(0).toUpperCase()}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              {reporterCharacterName && (
                <span className="text-xs font-medium text-foreground truncate max-w-[120px]">
                  {reporterCharacterName}
                </span>
              )}
              <PlayerBadge
                partyAbbrev={reporterPartyAbbrev ?? null}
                stateCode={reporterStateCode ?? null}
                countryId={reporterCountryId ?? null}
              />
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        {isMerged && (
          <div className="mb-2 rounded-md bg-muted/10 px-2 py-1 text-[10px] text-muted">
            Merged into{" "}
            <Link
              href={`/feedback/${mergedInto}`}
              className="text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              S#{mergedInto}
            </Link>
          </div>
        )}

        <h2 className="mb-1.5 font-semibold leading-snug text-foreground line-clamp-2">{title}</h2>

        <CategoryBadge
          category={category as "feature_request"}
          gameSystem={gameSystem as "elections"}
        />

        {descriptionPreview && !isMerged && (
          <p className="mt-2 line-clamp-3 text-sm text-foreground/80">{descriptionPreview}</p>
        )}

        {impactPreview && !isMerged && (
          <p className="mt-2 line-clamp-2 border-l-2 border-primary/40 pl-2 text-xs text-muted">
            <span className="font-medium text-foreground/70">Impact: </span>
            {impactPreview}
          </p>
        )}

        {/* Screenshot moved below content, capped to prevent giant images dominating */}
        {screenshotUrl && !isMerged && (
          <div className="mt-3 overflow-hidden rounded-md border border-card-border bg-card-elevated">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screenshotUrl} alt="" className="max-h-20 w-full object-cover object-top" />
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className="font-mono">S#{issueNumber}</span>
            <span>{formatTime(createdAt)}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => handleReact(e, "like")}
              disabled={reacting || isMerged}
              aria-pressed={myReaction === "like"}
              aria-label="Like"
              title={isMerged ? "Merged" : "Like"}
              className={`flex items-center gap-1 transition-colors ${
                myReaction === "like"
                  ? "text-green-500"
                  : isMerged
                    ? "text-muted cursor-default"
                    : "text-muted hover:text-green-500"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                />
              </svg>
              <span className="tabular-nums">{likeCount}</span>
            </button>
            <button
              type="button"
              onClick={(e) => handleReact(e, "dislike")}
              disabled={reacting || isMerged}
              aria-pressed={myReaction === "dislike"}
              aria-label="Dislike"
              title={isMerged ? "Merged" : "Dislike"}
              className={`flex items-center gap-1 transition-colors ${
                myReaction === "dislike"
                  ? "text-red-500"
                  : isMerged
                    ? "text-muted cursor-default"
                    : "text-muted hover:text-red-500"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
                />
              </svg>
              <span className="tabular-nums">{dislikeCount}</span>
            </button>
            <span className="flex items-center gap-1.5">
              <span>
                {commentCount} comment{commentCount === 1 ? "" : "s"}
              </span>
              {(unreadCommentCount ?? 0) > 0 && (
                <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {unreadCommentCount} new
                </span>
              )}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
