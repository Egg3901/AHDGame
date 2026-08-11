"use client";

import { useEffect, useRef, useState, memo } from "react";
import Image from "next/image";
import { Slider } from "@/components/ui";
import { youtubeThumbnailUrl } from "@/lib/utils/youtubeThumbnail";
import { useBrowserPreferences } from "@/contexts/BrowserPreferencesContext";

interface CampaignSongPlayerProps {
  videoId: string;
  ownerAutoplay: boolean;
  viewerDisablesAutoplay: boolean;
  characterName: string;
}

interface YTPlayer {
  getDuration(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
  getVideoData(): { title: string };
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  setVolume(volume: number): void;
}

interface YTPlayerEvent {
  target: YTPlayer;
  data: number;
}

declare global {
  interface Window {
    YT: {
      Player: new (element: HTMLElement, options: Record<string, unknown>) => YTPlayer;
      PlayerState: { PLAYING: number };
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

// Memoized equalizer to prevent re-renders
const EqualizerBadge = memo(function EqualizerBadge({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="flex items-end gap-0.5 h-4 px-2">
      {[40, 70, 100, 60, 80].map((height, i) => (
        <div
          key={i}
          className={`w-1 rounded-t ${isPlaying ? "bg-primary" : "bg-muted"}`}
          style={{
            height: isPlaying ? `${height}%` : "30%",
            animation: isPlaying ? `equalize-${i} 1.2s ease-in-out infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
});

export function CampaignSongPlayer({
  videoId,
  ownerAutoplay,
  viewerDisablesAutoplay,
  characterName,
}: CampaignSongPlayerProps) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoTitle, setVideoTitle] = useState("Loading...");
  const { preferences } = useBrowserPreferences();

  const shouldAutoplay = ownerAutoplay && !viewerDisablesAutoplay && preferences.gameSounds;

  const initPlayer = () => {
    if (!containerRef.current) return;

    playerRef.current = new window.YT.Player(containerRef.current, {
      videoId,
      playerVars: {
        autoplay: shouldAutoplay ? 1 : 0,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        showinfo: 0,
      },
      events: {
        onReady: (event: YTPlayerEvent) => {
          const player = event.target;
          player.setVolume(preferences.gameSounds ? preferences.masterVolume : 0);
          setDuration(player.getDuration());
          setVideoTitle(player.getVideoData().title);
          if (shouldAutoplay) {
            setIsPlaying(true);
          }
        },
        onStateChange: (event: YTPlayerEvent) => {
          setIsPlaying(event.data === window.YT.PlayerState.PLAYING);
        },
      },
    });

    // Only update the scrubber position while playing — avoid re-rendering every second when paused.
    const interval = setInterval(() => {
      if (
        playerRef.current?.getPlayerState &&
        playerRef.current.getPlayerState() === window.YT?.PlayerState?.PLAYING &&
        playerRef.current.getCurrentTime
      ) {
        setCurrentTime(playerRef.current.getCurrentTime());
      }
    }, 1000);

    return () => clearInterval(interval);
  };

  // Load YouTube IFrame API
  useEffect(() => {
    // window.YT may be partially initialized — wait for Player constructor before calling initPlayer.
    if (window.YT?.Player) {
      initPlayer();
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      initPlayer();
    };
  }, [videoId, shouldAutoplay]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playerRef.current || typeof playerRef.current.setVolume !== "function") return;
    playerRef.current.setVolume(preferences.gameSounds ? preferences.masterVolume : 0);
    if (!preferences.gameSounds && typeof playerRef.current.pauseVideo === "function") {
      playerRef.current.pauseVideo();
    }
  }, [preferences.gameSounds, preferences.masterVolume]);

  const togglePlay = () => {
    // Guard against partially initialized player — methods may not be bound yet.
    if (!playerRef.current || typeof playerRef.current.playVideo !== "function") return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const thumbnailUrl = youtubeThumbnailUrl(videoId);
  const remaining = duration - currentTime;

  return (
    <div className="relative rounded-xl border border-card-border bg-card/80 backdrop-blur-sm overflow-hidden shadow-card">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg
            className="h-5 w-5 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
            />
          </svg>
          <h3 className="text-sm font-semibold">{characterName}&apos;s Campaign Song</h3>
        </div>

        <div className="flex gap-4">
          {/* Album Art */}
          <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-background flex-shrink-0 shadow-md">
            <Image src={thumbnailUrl} alt="Album art" fill className="object-cover" sizes="80px" />
          </div>

          {/* Info & Controls */}
          <div className="flex-1 flex flex-col justify-between min-w-0">
            {/* Title and Equalizer Badge */}
            <div className="flex items-center gap-2 mb-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{videoTitle}</p>
                <p className="text-xs text-muted">{characterName}</p>
              </div>

              {/* Small Equalizer Badge */}
              <EqualizerBadge isPlaying={isPlaying} />

              {/* Play/Pause Button */}
              <button
                onClick={togglePlay}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-primary hover:bg-primary/90 flex items-center justify-center transition-colors"
              >
                {isPlaying ? (
                  <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg
                    className="h-4 w-4 text-white ml-0.5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Progress Slider */}
            <div className="space-y-1">
              <Slider
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={(e) => {
                  const time = parseFloat(e.target.value);
                  if (playerRef.current && typeof playerRef.current.seekTo === "function") {
                    playerRef.current.seekTo(time);
                  }
                  setCurrentTime(time);
                }}
                variant="primary"
                className="w-full"
              />
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{formatTime(currentTime)}</span>
                <span>-{formatTime(remaining)}</span>
              </div>
            </div>
          </div>
        </div>

        {viewerDisablesAutoplay && ownerAutoplay && (
          <p className="mt-4 text-xs text-muted flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Autoplay disabled by your preferences
          </p>
        )}
      </div>

      {/* YouTube Player — must have non-zero dimensions or browsers pause playback */}
      <div
        ref={containerRef}
        className="absolute w-px h-px overflow-hidden"
        style={{ clip: "rect(0,0,0,0)" }}
      />

      <style jsx>{`
        @keyframes equalize-0 {
          0%,
          100% {
            height: 40%;
          }
          50% {
            height: 90%;
          }
        }
        @keyframes equalize-1 {
          0%,
          100% {
            height: 70%;
          }
          50% {
            height: 95%;
          }
        }
        @keyframes equalize-2 {
          0%,
          100% {
            height: 100%;
          }
          50% {
            height: 50%;
          }
        }
        @keyframes equalize-3 {
          0%,
          100% {
            height: 60%;
          }
          50% {
            height: 85%;
          }
        }
        @keyframes equalize-4 {
          0%,
          100% {
            height: 80%;
          }
          50% {
            height: 100%;
          }
        }
      `}</style>
    </div>
  );
}
