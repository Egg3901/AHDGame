"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Avatar } from "@/components/Avatar";
import { SubscribeButton } from "@/components/SubscribeButton";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { getPartyColor } from "@/lib/utils/politics";
import { RelativeTime } from "@/components/time/LocalTime";
import type { NewsCategory, NewsFeedType, ProfileBorderKey } from "@/lib/db/types";

export interface SerializedPost {
  _id: string;
  authorId: string;
  authorSequentialId: number | null;
  authorName: string;
  authorAvatarUrl: string | null;
  authorParty: string | null;
  authorBorderKey?: ProfileBorderKey | null;
  authorTintColor?: string | null;
  title: string | null;
  content: string;
  /** Optional hero image (player posts). */
  imageUrl?: string | null;
  feedType?: NewsFeedType;
  isSystem?: boolean;
  category?: NewsCategory | null;
  reactions: { agree: number; disagree: number };
  replyCount: number;
  userReaction: "agree" | "disagree" | null;
  createdAt: string;
  /** ISO timestamp of the last author edit; drives the "(edited)" marker. */
  editedAt?: string | null;
}

export interface SerializedReply {
  _id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorParty: string | null;
  authorBorderKey?: ProfileBorderKey | null;
  authorTintColor?: string | null;
  content: string;
  reactions: { agree: number; disagree: number };
  createdAt: string;
}

interface NewsPostProps {
  post: SerializedPost;
  canInteract: boolean;
  /** Character _id of the signed-in viewer, used to show the author-only Edit affordance. */
  currentCharacterId?: string | null;
  moderationApiBase?: "/api/admin" | "/api/moderator" | null;
  onReactionChange: (
    postId: string,
    reactions: { agree: number; disagree: number },
    userReaction: "agree" | "disagree" | null
  ) => void;
  onModerationRemove?: (postId: string) => void;
  onPostEdited?: (
    postId: string,
    patch: {
      title: string | null;
      content: string;
      imageUrl: string | null;
      editedAt: string | null;
    }
  ) => void;
}

function PartyBadge({ party }: { party: string | null }) {
  if (!party) return null;

  const isStandard = ["democrat", "republican", "independent"].includes(party);
  const label = party
    .split("_")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

  if (isStandard) {
    return (
      <span
        className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${getPartyColor(party)}`}
      >
        {label}
      </span>
    );
  }

  return (
    <span className="inline-block rounded-full border border-card-border bg-card-elevated px-2 py-0.5 text-[10px] font-medium text-muted">
      {label}
    </span>
  );
}

export function NewsPost({
  post,
  canInteract,
  currentCharacterId = null,
  moderationApiBase = null,
  onReactionChange,
  onModerationRemove,
  onPostEdited,
}: NewsPostProps) {
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [replies, setReplies] = useState<SerializedReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyCount, setReplyCount] = useState(post.replyCount);
  const [reactingTo, setReactingTo] = useState<string | null>(null);

  const isAuthor = !post.isSystem && !!currentCharacterId && post.authorId === currentCharacterId;
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editImageUploading, setEditImageUploading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  function startEditing() {
    setEditTitle(post.title ?? "");
    setEditContent(post.content);
    setEditImageUrl(post.imageUrl ?? null);
    setEditError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditError(null);
  }

  async function handleEditImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || editImageUploading) return;

    setEditImageUploading(true);
    setEditError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/upload/news-image", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) {
        setEditError(data.error ?? "Image upload failed");
        return;
      }
      if (data.url) setEditImageUrl(data.url);
    } catch {
      setEditError("Image upload failed. Try again.");
    } finally {
      setEditImageUploading(false);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editContent.trim() || editSubmitting) return;

    setEditSubmitting(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/news/${post._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim() || undefined,
          content: editContent.trim(),
          ...(editImageUrl ? { imageUrl: editImageUrl } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error ?? "Failed to save changes");
        return;
      }

      const data = await res.json();
      const updated: SerializedPost = data.post;
      onPostEdited?.(post._id, {
        title: updated.title,
        content: updated.content,
        imageUrl: updated.imageUrl ?? null,
        editedAt: updated.editedAt ?? null,
      });
      setEditing(false);
    } catch {
      setEditError("Network error. Please try again.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleReact(reaction: "agree" | "disagree") {
    if (!canInteract || reactingTo) return;
    setReactingTo(reaction);
    try {
      const res = await fetch(`/api/news/${post._id}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction }),
      });
      if (res.ok) {
        const data = await res.json();
        onReactionChange(post._id, data.reactions, data.userReaction);
      }
    } finally {
      setReactingTo(null);
    }
  }

  async function toggleReplies() {
    if (repliesOpen) {
      setRepliesOpen(false);
      return;
    }
    setRepliesOpen(true);
    if (replies.length === 0 && replyCount > 0) {
      setRepliesLoading(true);
      try {
        const res = await fetch(`/api/news/${post._id}/replies`);
        if (res.ok) {
          const data = await res.json();
          setReplies(data.replies);
        }
      } finally {
        setRepliesLoading(false);
      }
    }
  }

  async function handleModerationRemove() {
    if (!moderationApiBase || post.isSystem || removing) return;
    if (
      !window.confirm("Remove this post (and all replies) from the site? This cannot be undone.")
    ) {
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch(`${moderationApiBase}/news/${post._id}`, { method: "DELETE" });
      if (res.ok) {
        onModerationRemove?.(post._id);
      }
    } finally {
      setRemoving(false);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyContent.trim() || replySubmitting) return;
    setReplySubmitting(true);
    try {
      const res = await fetch(`/api/news/${post._id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyContent.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setReplies((prev) => [...prev, data.reply]);
        setReplyCount((c) => c + 1);
        setReplyContent("");
      }
    } finally {
      setReplySubmitting(false);
    }
  }

  return (
    <div
      className={`rounded-xl border shadow-card p-4 transition-all hover:border-card-border/80 hover:shadow-panel hover:bg-card-elevated/30 ${
        post.isSystem ? "border-primary/20 bg-card/80" : "border-card-border bg-card"
      }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start gap-3">
        {post.isSystem ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <svg
              className="h-4.5 w-4.5 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
              />
            </svg>
          </div>
        ) : (
          <Avatar
            url={post.authorAvatarUrl}
            name={post.authorName}
            size="h-9 w-9"
            borderKey={post.authorBorderKey}
            tintColor={post.authorTintColor}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {post.isSystem ? (
              <span className="font-medium text-primary">{post.authorName}</span>
            ) : (
              <Link
                href={`/character/${post.authorSequentialId ?? post.authorId}`}
                className="font-medium text-foreground hover:text-primary transition-colors"
              >
                {post.authorName}
              </Link>
            )}
            {!post.isSystem && <PartyBadge party={post.authorParty} />}
            {!post.isSystem && post.feedType === "advertisement" && (
              <span className="inline-block rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                Sponsored
              </span>
            )}
            {post.isSystem && post.category && (
              <span className="inline-block rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">
                {post.category.charAt(0).toUpperCase() + post.category.slice(1)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-1">
            <RelativeTime className="text-xs text-muted" value={post.createdAt} />
            {post.editedAt && (
              <span className="text-[10px] italic text-muted" title="This post was edited">
                (edited)
              </span>
            )}
            {!post.isSystem && (
              <Link
                href={`/news/post/${post._id}`}
                className="text-[10px] font-medium uppercase tracking-wide text-muted hover:text-primary transition-colors"
              >
                Permalink
              </Link>
            )}
            {isAuthor && !editing && (
              <button
                type="button"
                onClick={startEditing}
                className="text-[10px] font-semibold uppercase tracking-wide text-muted hover:text-primary transition-colors"
              >
                Edit
              </button>
            )}
            {!post.isSystem && <SubscribeButton characterId={post.authorId} />}
            {moderationApiBase && !post.isSystem && (
              <button
                type="button"
                onClick={() => void handleModerationRemove()}
                disabled={removing}
                className="text-[10px] font-semibold uppercase tracking-wide text-muted hover:text-error disabled:opacity-50"
              >
                {removing ? "Removing…" : "Remove post"}
              </button>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        /* Inline edit form (author only) */
        <form onSubmit={handleSaveEdit} className="mb-3 space-y-2">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title (optional)"
            maxLength={100}
            className="w-full max-w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-semibold text-foreground placeholder:text-muted placeholder:font-normal focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            maxLength={1000}
            rows={4}
            className="w-full max-w-full resize-none rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />

          <input
            ref={editFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleEditImagePick}
            aria-hidden="true"
          />

          {editImageUrl ? (
            <div className="relative overflow-hidden rounded-lg border border-card-border bg-card-muted">
              <div className="relative aspect-video w-full max-h-48">
                <Image
                  src={editImageUrl}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 560px"
                  unoptimized={bypassNextImageOptimization(editImageUrl)}
                />
              </div>
              <button
                type="button"
                onClick={() => setEditImageUrl(null)}
                className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/80"
              >
                Remove image
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => editFileInputRef.current?.click()}
              disabled={editImageUploading}
              className="text-xs font-medium text-muted hover:text-primary transition-colors disabled:opacity-50"
            >
              {editImageUploading ? "Uploading image…" : "+ Add image (optional)"}
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!editContent.trim() || editSubmitting || editImageUploading}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editSubmitting ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={editSubmitting}
              className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            {editError && <span className="text-xs text-error">{editError}</span>}
          </div>
        </form>
      ) : (
        <>
          {/* Title */}
          {post.title && <p className="mb-1 text-sm font-semibold text-foreground">{post.title}</p>}

          {/* Optional hero image */}
          {post.imageUrl && !post.isSystem && (
            <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-lg border border-card-border bg-card-muted">
              <Image
                src={post.imageUrl}
                alt={post.title ? `Image: ${post.title}` : "Post image"}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 720px"
                unoptimized={
                  bypassNextImageOptimization(post.imageUrl) || post.imageUrl.includes("localhost")
                }
              />
            </div>
          )}

          {/* Content */}
          <p className="mb-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {post.content}
          </p>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-4 border-t border-card-border pt-3">
        <button
          onClick={() => handleReact("agree")}
          disabled={!canInteract || !!reactingTo}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            post.userReaction === "agree"
              ? "text-green-500"
              : canInteract
                ? "text-muted hover:text-green-500"
                : "text-muted cursor-default"
          }`}
          title={canInteract ? "Agree" : "Log in to react"}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          onClick={() => handleReact("disagree")}
          disabled={!canInteract || !!reactingTo}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            post.userReaction === "disagree"
              ? "text-red-500"
              : canInteract
                ? "text-muted hover:text-red-500"
                : "text-muted cursor-default"
          }`}
          title={canInteract ? "Disagree" : "Log in to react"}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
            />
          </svg>
          <span>{post.reactions.disagree}</span>
        </button>

        <button
          onClick={toggleReplies}
          className="ml-auto flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <span>
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
          <svg
            className={`h-3 w-3 transition-transform ${repliesOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Replies */}
      {repliesOpen && (
        <div className="mt-3 border-t border-card-border pt-3 space-y-3">
          {repliesLoading ? (
            <div className="py-4 text-center text-xs text-muted">Loading replies...</div>
          ) : replies.length === 0 && replyCount === 0 ? (
            <p className="text-xs text-muted">No replies yet.</p>
          ) : (
            replies.map((reply) => (
              <div key={reply._id} className="flex gap-2.5">
                <Avatar
                  url={reply.authorAvatarUrl}
                  name={reply.authorName}
                  size="h-7 w-7"
                  borderKey={reply.authorBorderKey}
                  tintColor={reply.authorTintColor}
                />
                <div className="flex-1 min-w-0 rounded-lg bg-card-muted/60 p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium">{reply.authorName}</span>
                    <PartyBadge party={reply.authorParty} />
                    <RelativeTime
                      className="ml-auto text-[10px] text-muted"
                      value={reply.createdAt}
                    />
                  </div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
                    {reply.content}
                  </p>
                </div>
              </div>
            ))
          )}

          {canInteract && (
            <form onSubmit={handleReply} className="flex gap-2 pt-1">
              <input
                type="text"
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Write a reply..."
                maxLength={500}
                className="flex-1 rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
              />
              <button
                type="submit"
                disabled={!replyContent.trim() || replySubmitting}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reply
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
