"use client";

import { useState } from "react";
import Image from "next/image";
import { youtubeThumbnailUrl } from "@/lib/utils/youtubeThumbnail";

interface CampaignSongPlayerProps {
  videoId: string;
  characterName: string;
  /** Heading shown above the player; defaults to "<name>'s Campaign Song". */
  label?: string;
}

/**
 * A player's campaign song, played only through YouTube's own visible player.
 *
 * Nothing from YouTube loads until the viewer presses play: the collapsed row
 * is our thumbnail and a button. Pressing it mounts the standard embed at full
 * card width (YouTube requires a visible player of at least 200x200 and forbids
 * audio-only or hidden playback, which the old 1px background player did).
 * There is no autoplay. The phone app hides the block entirely (App Store rule
 * 5.2.3; its webview would also hand the embed to the YouTube app).
 */
export function CampaignSongPlayer({ videoId, characterName, label }: CampaignSongPlayerProps) {
  const [open, setOpen] = useState(false);
  const heading = label ?? `${characterName}'s Campaign Song`;
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
    videoId
  )}?autoplay=1&rel=0&playsinline=1`;

  return (
    <div className="store-app-hidden">
      <div className="flex items-center gap-3">
        <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-background">
          <Image
            src={youtubeThumbnailUrl(videoId)}
            alt=""
            fill
            className="object-cover"
            sizes="48px"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{heading}</p>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted hover:text-foreground"
          >
            Watch on YouTube
          </a>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? `Close ${heading}` : `Play ${heading}`}
          className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {open ? (
            "Close"
          ) : (
            <>
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
              Play
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="mt-3 aspect-video min-h-[200px] w-full overflow-hidden rounded-lg bg-black">
          <iframe
            src={embedUrl}
            title={heading}
            className="h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      )}
    </div>
  );
}
