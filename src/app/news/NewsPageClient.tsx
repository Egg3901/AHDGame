"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { NewsTab } from "@/components/news/NewsTab";
import { NewsComposer } from "@/components/news/NewsComposer";
import { BannerAdComposer } from "@/components/news/BannerAdComposer";
import BackButton from "@/components/BackButton";
import { HeroImage } from "@/components/HeroImage";
import type { SerializedPost } from "@/components/news/NewsPost";
import type { NewsFeedType } from "@/lib/db/types";
import { AdSenseUnit } from "@/components/AdSenseUnit";
import { useAuthMe } from "@/contexts/AuthDataContext";

const HERO_IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/An_old_man_in_newsagent%27s_shop%2C_Paris_September_2011.jpg/960px-An_old_man_in_newsagent%27s_shop%2C_Paris_September_2011.jpg";

export function NewsPageClient({
  authorId,
  initialPosts,
}: {
  authorId: string | null;
  initialPosts?: SerializedPost[];
}) {
  const [composerFeedType, setComposerFeedType] = useState<NewsFeedType | null>(null);
  const [composerMode, setComposerMode] = useState<"text" | "banner">("text");
  const [activeFeed, setActiveFeed] = useState<"article" | "advertisement">("article");
  const { user, loading: userLoading } = useAuthMe();

  const onPostRef = useRef<((post: SerializedPost) => void) | null>(null);
  const registerOnPost = useCallback((fn: (post: SerializedPost) => void) => {
    onPostRef.current = fn;
  }, []);

  const currentUser = (() => {
    const character = user?.imperialCharacter ?? user?.character;
    if (!character?.name) return null;
    return {
      name: String(character.name),
      avatarUrl: typeof character.avatarUrl === "string" ? character.avatarUrl : null,
      borderKey: typeof character.borderKey === "string" ? character.borderKey : null,
      tintColor: typeof character.tintColor === "string" ? character.tintColor : null,
    };
  })();

  useEffect(() => {
    if (!composerFeedType) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setComposerFeedType(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [composerFeedType]);

  const handlePost = (post: SerializedPost) => {
    const kind = post.feedType ?? "article";
    setActiveFeed(kind === "advertisement" ? "advertisement" : "article");
    onPostRef.current?.(post);
    setComposerFeedType(null);
  };

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-8 pt-4 space-y-6 overflow-hidden">
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <HeroImage
              src={HERO_IMAGE_URL}
              alt="Newsagent's shop in Paris"
              fill
              className="object-cover"
              style={{ objectPosition: "center 30%" }}
              priority
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
              aria-hidden
            />

            <div className="absolute inset-0 flex flex-col justify-between px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex items-center justify-between gap-2">
                <BackButton iconOnly fallbackLabel="Back" fallbackHref="/dashboard" />
                {!userLoading && currentUser && !authorId && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setComposerMode("text");
                        setComposerFeedType("article");
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-md ring-1 ring-primary/30 transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
                    >
                      <svg
                        className="h-4 w-4 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      Post news
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setComposerMode("text");
                        setComposerFeedType("advertisement");
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100 shadow-md backdrop-blur-sm transition-colors hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
                    >
                      Place ad
                    </button>
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <p className="mb-1 text-xs italic text-white/80 drop-shadow">
                  Free reporting and optional sponsored placements
                </p>
                <h1
                  data-coach="nav-news"
                  className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl"
                >
                  News & Events
                </h1>
              </div>
            </div>
          </div>
          {/* Editorial intro for crawlers and discovery */}
          <div className="border-t border-card-border bg-card px-5 py-4 sm:px-6">
            <p className="text-sm text-muted leading-relaxed">
              The in-character news wire for A House Divided. Read player-written headlines,
              campaign updates, policy editorials, and election coverage from the United States,
              United Kingdom, Germany, and Japan simulations. Posts refresh as the hourly game clock
              advances — one real hour equals one simulated political week. Registered players can
              publish free news articles or place sponsored political ads.
            </p>
          </div>
        </header>

        <AdSenseUnit slot="ahd-news-infeed" format="fluid" className="min-h-[90px] my-4" />

        <NewsTab
          authorId={authorId}
          initialPosts={activeFeed === "article" ? initialPosts : undefined}
          registerOnPost={registerOnPost}
          activeFeed={activeFeed}
          onActiveFeedChange={setActiveFeed}
        />
      </main>

      {composerFeedType && currentUser && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] sm:pt-[15vh]"
          onClick={() => setComposerFeedType(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={
              composerMode === "banner"
                ? "Upload banner ad"
                : composerFeedType === "article"
                  ? "Compose news post"
                  : "Place sponsored post"
            }
          >
            <div className="space-y-2">
              {/* Toggle row */}
              <div className="flex items-center justify-between">
                <div className="flex rounded-lg border border-white/20 bg-black/40 backdrop-blur-sm p-0.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setComposerMode("text")}
                    className={`rounded-md px-3 py-1.5 transition-colors ${composerMode === "text" ? "bg-white/90 text-black" : "text-white/70 hover:text-white"}`}
                  >
                    {composerFeedType === "advertisement" ? "Sponsored post" : "Text post"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerMode("banner")}
                    className={`rounded-md px-3 py-1.5 transition-colors ${composerMode === "banner" ? "bg-white/90 text-black" : "text-white/70 hover:text-white"}`}
                  >
                    Banner ad
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setComposerFeedType(null)}
                  className="text-xs text-white/60 hover:text-white"
                >
                  Close
                </button>
              </div>

              {composerMode === "banner" ? (
                <div className="rounded-xl border border-card-border bg-card p-4">
                  <h2 className="text-sm font-semibold text-foreground mb-3">Upload Banner Ad</h2>
                  <BannerAdComposer onClose={() => setComposerFeedType(null)} />
                </div>
              ) : (
                <NewsComposer
                  feedType={composerFeedType}
                  authorName={currentUser.name}
                  authorAvatarUrl={currentUser.avatarUrl}
                  authorBorderKey={
                    currentUser.borderKey as import("@/lib/db/types").ProfileBorderKey
                  }
                  authorTintColor={currentUser.tintColor}
                  onPost={handlePost}
                  onClose={() => setComposerFeedType(null)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
