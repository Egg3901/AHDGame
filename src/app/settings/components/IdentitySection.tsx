"use client";

import { useState } from "react";
import Image from "next/image";
import { MessageBanner, SpinnerIcon } from "./shared";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

function getDiscordAvatarUrl(discordId: string, avatarHash: string | null | undefined): string {
  if (avatarHash) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
  }
  const defaultIndex = Number(BigInt(discordId) % BigInt(5));
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

interface CharacterData {
  discordId?: string;
  discordUsername?: string;
  discordAvatar?: string;
  googleId?: string;
  googleEmail?: string;
  googleName?: string;
  googleAvatar?: string;
}

interface Props {
  character: CharacterData;
  onCharacterUpdate: (updates: Partial<CharacterData>) => void;
}

function ProviderCard({
  provider,
  isLinked,
  avatarUrl,
  displayName,
  subtitle,
  linkUrl,
  unlinkUrl,
  brandColor,
  icon,
  onUnlink,
}: {
  provider: string;
  isLinked: boolean;
  avatarUrl: string | null;
  displayName?: string;
  subtitle: string;
  linkUrl: string;
  unlinkUrl: string;
  brandColor: string;
  icon: React.ReactNode;
  onUnlink: () => void;
}) {
  const [unlinking, setUnlinking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const handleUnlink = async () => {
    setUnlinking(true);
    setMsg(null);
    try {
      const res = await fetch(unlinkUrl, { method: "POST" });
      if (res.ok) {
        onUnlink();
        setMsg({ text: `${provider} unlinked successfully.`, ok: true });
      } else {
        const data = await res.json();
        setMsg({ text: data.error ?? "Failed to unlink.", ok: false });
      }
    } catch {
      setMsg({ text: "Network error.", ok: false });
    } finally {
      setUnlinking(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <div className="space-y-3">
      {isLinked ? (
        <div className="flex items-center gap-4 p-4 rounded-xl border border-card-border bg-card-elevated">
          {avatarUrl && (
            <Image
              src={avatarUrl}
              alt={`${provider} avatar`}
              width={48}
              height={48}
              className="rounded-lg"
              unoptimized={bypassNextImageOptimization(avatarUrl)}
            />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{displayName}</p>
            <p className="text-xs text-muted">{subtitle}</p>
          </div>
          <button
            onClick={handleUnlink}
            disabled={unlinking}
            className="rounded-xl bg-error/10 border border-error/20 px-4 py-2 text-sm font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {unlinking ? (
              <span className="flex items-center gap-2">
                <SpinnerIcon />
                Unlinking...
              </span>
            ) : (
              "Unlink"
            )}
          </button>
        </div>
      ) : (
        <form action={linkUrl} method="GET" className="inline-block">
          <button
            type="submit"
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors ${brandColor}`}
          >
            {icon}
            Link {provider}
          </button>
        </form>
      )}
      {msg && <MessageBanner ok={msg.ok} text={msg.text} onDismiss={() => setMsg(null)} />}
    </div>
  );
}

const DiscordIcon = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const GoogleIcon = (
  <svg className="h-5 w-5" viewBox="0 0 24 24">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

export function IdentitySection({ character, onCharacterUpdate }: Props) {
  const discordAvatarUrl = character.discordId
    ? getDiscordAvatarUrl(character.discordId, character.discordAvatar ?? null)
    : null;

  return (
    <>
      <p className="text-sm text-muted mb-6">
        Link your social accounts so other players can contact you.
      </p>

      <div className="space-y-4">
        {/* Google — in development, show disabled card */}
        <div className="flex items-center gap-4 p-4 rounded-xl border border-card-border/50 bg-card/50 opacity-60">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card-muted border border-card-border">
            {GoogleIcon}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-muted">Google</p>
              <span className="rounded-full bg-warning/20 border border-warning/30 px-2 py-0.5 text-[10px] font-semibold text-warning">
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-muted/70">Google sign-in is under development</p>
          </div>
        </div>

        <ProviderCard
          provider="Discord"
          isLinked={!!character.discordId}
          avatarUrl={discordAvatarUrl}
          displayName={character.discordUsername}
          subtitle="Discord account linked"
          linkUrl="/api/auth/discord"
          unlinkUrl="/api/auth/discord/unlink"
          brandColor="bg-[#5865F2] hover:bg-[#4752C4]"
          icon={DiscordIcon}
          onUnlink={() =>
            onCharacterUpdate({
              discordId: undefined,
              discordUsername: undefined,
              discordAvatar: undefined,
            })
          }
        />
      </div>
    </>
  );
}
