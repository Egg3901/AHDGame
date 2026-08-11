"use client";

import { useState, useEffect } from "react";
import { logError } from "@/lib/utils/errorLog";

interface SubscribeButtonProps {
  characterId: string;
}

export function SubscribeButton({ characterId }: SubscribeButtonProps) {
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [hasCharacter, setHasCharacter] = useState(false);
  const [isSelf, setIsSelf] = useState(false);

  useEffect(() => {
    // Check if user has a character (needed to subscribe)
    fetch("/api/character/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.character) {
          setHasCharacter(true);
          if (data.character._id === characterId) setIsSelf(true);
        }
      })
      .catch((error) => {
        logError(error, {
          component: "SubscribeButton",
          action: "fetch current user character",
        });
      });

    fetch(`/api/characters/${characterId}/subscribe`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setSubscribed(data.subscribed);
          setSubscriberCount(data.subscriberCount ?? 0);
        }
      })
      .catch((error) => {
        logError(error, {
          component: "SubscribeButton",
          action: "fetch subscription status",
        });
      })
      .finally(() => setLoading(false));
  }, [characterId]);

  async function toggle() {
    if (toggling || !hasCharacter) return;
    setToggling(true);
    try {
      const method = subscribed ? "DELETE" : "POST";
      const res = await fetch(`/api/characters/${characterId}/subscribe`, { method });
      if (res.ok) {
        const data = await res.json();
        setSubscribed(data.subscribed);
        setSubscriberCount(data.subscriberCount ?? 0);
      }
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return <div className="h-8 w-28 animate-pulse rounded-lg bg-card-border" />;
  }

  if (isSelf) return null;

  if (!hasCharacter) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        <span>
          {subscriberCount} subscriber{subscriberCount !== 1 ? "s" : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={toggle}
        disabled={toggling}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
          subscribed
            ? "border-primary/50 bg-primary/10 text-primary hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400"
            : "border-card-border bg-card text-muted hover:border-primary/50 hover:text-primary"
        }`}
        title={subscribed ? "Unsubscribe" : "Subscribe to get notified when they post"}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {toggling ? "..." : subscribed ? "Subscribed" : "Subscribe"}
      </button>
      <span className="text-sm text-muted">
        {subscriberCount} subscriber{subscriberCount !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
