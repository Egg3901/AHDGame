"use client";

import { useState, useEffect } from "react";
import type { SerializedPost } from "./NewsPost";
import { NewsFeed } from "./NewsFeed";
import { NewsWhoToWatch } from "./NewsWhoToWatch";

interface CurrentUser {
  name: string;
  avatarUrl?: string | null;
}

interface NewsTabProps {
  authorId?: string | null;
  initialPosts?: SerializedPost[];
  registerOnPost?: (fn: (post: SerializedPost) => void) => void;
  activeFeed: "article" | "advertisement";
  onActiveFeedChange: (feed: "article" | "advertisement") => void;
}

export function NewsTab({
  authorId,
  initialPosts,
  registerOnPost,
  activeFeed,
  onActiveFeedChange,
}: NewsTabProps) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null | undefined>(undefined);
  const [currentCharacterId, setCurrentCharacterId] = useState<string | null>(null);
  const [moderationApiBase, setModerationApiBase] = useState<
    "/api/admin" | "/api/moderator" | null
  >(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/character/me").then((res) => (res.ok ? res.json() : null)),
      fetch("/api/auth/me").then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([charData, authData]) => {
        if (charData?.character) {
          setCurrentUser({ name: charData.character.name, avatarUrl: null });
          setCurrentCharacterId(charData.character._id ?? null);
        } else {
          setCurrentUser(null);
          setCurrentCharacterId(null);
        }
        if (authData?.user?.isAdmin) setModerationApiBase("/api/admin");
        else if (authData?.user?.isModerator) setModerationApiBase("/api/moderator");
        else setModerationApiBase(null);
      })
      .catch(() => {
        setCurrentUser(null);
        setCurrentCharacterId(null);
        setModerationApiBase(null);
      });
  }, []);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-3 max-w-full">
        {/* Feed — 2/3 width */}
        <div className="lg:col-span-2 min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2 rounded-xl border border-card-border bg-card p-1">
            <button
              type="button"
              onClick={() => onActiveFeedChange("article")}
              className={`flex-1 min-w-[120px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                activeFeed === "article"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:text-foreground hover:bg-card-muted/60"
              }`}
            >
              News
            </button>
            <button
              type="button"
              onClick={() => onActiveFeedChange("advertisement")}
              className={`flex-1 min-w-[120px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                activeFeed === "advertisement"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:text-foreground hover:bg-card-muted/60"
              }`}
            >
              Sponsored
            </button>
          </div>
          {/* With server-fetched posts, render the feed immediately (SSR-visible for
              crawlers); auth-dependent affordances fill in once /api/auth/me resolves. */}
          {currentUser === undefined && !initialPosts ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-card-border bg-card p-4 animate-pulse"
                >
                  <div className="flex gap-3 mb-3">
                    <div className="h-9 w-9 rounded-full bg-card-border shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-32 rounded bg-card-border" />
                      <div className="h-2.5 w-20 rounded bg-card-border" />
                    </div>
                    <div className="h-2.5 w-12 rounded bg-card-border shrink-0" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-full rounded bg-card-border" />
                    <div className="h-3 w-4/5 rounded bg-card-border" />
                    <div className="h-3 w-3/5 rounded bg-card-border" />
                  </div>
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-card-border">
                    <div className="h-2.5 w-12 rounded bg-card-border" />
                    <div className="h-2.5 w-16 rounded bg-card-border" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <NewsFeed
              key={activeFeed}
              feed={activeFeed}
              currentUser={currentUser ?? null}
              currentCharacterId={currentCharacterId}
              authorId={authorId}
              initialPosts={initialPosts}
              registerOnPost={registerOnPost}
              moderationApiBase={moderationApiBase}
            />
          )}
        </div>

        {/* Sidebar — 1/3 width */}
        <div className="space-y-6 min-w-0">
          <NewsWhoToWatch />

          {currentUser === null && (
            <div className="rounded-xl border border-card-border bg-card p-5">
              <h3 className="mb-2 text-sm font-semibold">Join the conversation</h3>
              <p className="text-xs text-muted">
                Create a character and log in to post free news (12h cooldown), place sponsored
                posts (5 AP + $100k personal cash), and react to the feed.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
