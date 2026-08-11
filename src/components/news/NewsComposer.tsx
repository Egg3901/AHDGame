"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { Avatar } from "@/components/Avatar";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import type { NewsFeedType, ProfileBorderKey } from "@/lib/db/types";

export interface ComposedNewsPost {
  _id: string;
  authorId: string;
  authorSequentialId: number | null;
  authorName: string;
  authorAvatarUrl: string | null;
  authorParty: string | null;
  title: string | null;
  content: string;
  feedType: NewsFeedType;
  reactions: { agree: number; disagree: number };
  replyCount: number;
  userReaction: null;
  createdAt: string;
  imageUrl?: string | null;
}

interface NewsComposerProps {
  feedType: NewsFeedType;
  authorName: string;
  authorAvatarUrl?: string | null;
  authorBorderKey?: ProfileBorderKey | null;
  authorTintColor?: string | null;
  onPost: (post: ComposedNewsPost) => void;
  onClose?: () => void;
}

export function NewsComposer({
  feedType,
  authorName,
  authorAvatarUrl,
  authorBorderKey,
  authorTintColor,
  onPost,
  onClose,
}: NewsComposerProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const remaining = 1000 - content.length;
  const isAd = feedType === "advertisement";

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || imageUploading) return;

    setImageUploading(true);
    setError(null);
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
        setError(data.error ?? "Image upload failed");
        return;
      }
      if (data.url) setImageUrl(data.url);
    } catch {
      setError("Image upload failed. Try again.");
    } finally {
      setImageUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          content: content.trim(),
          feedType,
          ...(imageUrl ? { imageUrl } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to post");
        return;
      }

      const data = await res.json();
      onPost(data.post);
      setTitle("");
      setContent("");
      setImageUrl(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-card-border bg-card p-4 overflow-hidden"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-foreground">
          {isAd ? "Place sponsored post" : "Write a news post"}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-foreground"
          >
            Close
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <Avatar
          url={authorAvatarUrl}
          name={authorName}
          size="h-9 w-9"
          className="shrink-0"
          borderKey={authorBorderKey}
          tintColor={authorTintColor}
        />
        <div className="flex-1 min-w-0 overflow-hidden">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            maxLength={100}
            className="mb-2 w-full max-w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-semibold text-foreground placeholder:text-muted placeholder:font-normal focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              isAd
                ? "Promotional copy, campaign slogan, or paid message…"
                : "Political update, analysis, or reporting — no charge…"
            }
            maxLength={1000}
            rows={3}
            className="w-full max-w-full resize-none rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleImagePick}
            aria-hidden="true"
          />

          {imageUrl ? (
            <div className="relative mt-3 overflow-hidden rounded-lg border border-card-border bg-card-muted">
              <div className="relative aspect-video w-full max-h-48">
                <Image
                  src={imageUrl}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 560px"
                  unoptimized={bypassNextImageOptimization(imageUrl)}
                />
              </div>
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/80"
              >
                Remove image
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={imageUploading}
                className="text-xs font-medium text-muted hover:text-primary transition-colors disabled:opacity-50"
              >
                {imageUploading ? "Uploading image…" : "+ Add image (optional)"}
              </button>
              <p className="mt-0.5 text-[10px] text-muted/80">PNG, JPEG, or WebP · max 8 MB</p>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs ${remaining < 100 ? "text-amber-500" : "text-muted"}`}>
              {remaining} characters remaining
            </span>
            <button
              type="submit"
              disabled={!content.trim() || submitting}
              className="flex flex-col items-center rounded-lg bg-primary px-4 py-1.5 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-sm font-medium">{submitting ? "Posting…" : "Post"}</span>
              <span className="text-[10px] opacity-75">
                {isAd
                  ? "5 actions · $100,000 personal cash · 30 min cooldown"
                  : "Free · 12 hour cooldown"}
              </span>
            </button>
          </div>
          {error && <p className="mt-1 text-xs text-error">{error}</p>}
        </div>
      </div>
    </form>
  );
}
