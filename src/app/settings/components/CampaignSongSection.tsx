"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { MessageBanner, SpinnerIcon, CheckIcon } from "./shared";

function extractYouTubeId(input: string): string | null {
  if (!input) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return null;
}

interface CharacterData {
  campaignSongUrl?: string;
  campaignSongAutoplay?: boolean;
}

interface Props {
  character: CharacterData;
  onCharacterUpdate: (updates: Partial<CharacterData>) => void;
}

export function CampaignSongSection({ character, onCharacterUpdate }: Props) {
  const t = useTranslations("settings");
  const [campaignSongUrl, setCampaignSongUrl] = useState(character.campaignSongUrl ?? "");
  const [campaignSongAutoplay, setCampaignSongAutoplay] = useState(
    character.campaignSongAutoplay ?? false
  );
  const [campaignSongSaving, setCampaignSongSaving] = useState(false);
  const [campaignSongMsg, setCampaignSongMsg] = useState<{ text: string; ok: boolean } | null>(
    null
  );
  const [campaignSongSaved, setCampaignSongSaved] = useState(false);

  const campaignSongVideoId = extractYouTubeId(campaignSongUrl);
  const campaignSongValidation = {
    valid: !campaignSongUrl || !!campaignSongVideoId,
    videoId: campaignSongVideoId,
  };

  const handleCampaignSongSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setCampaignSongSaving(true);
    setCampaignSongMsg(null);
    try {
      const res = await fetch("/api/settings/campaign-song", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignSongUrl, campaignSongAutoplay }),
      });
      const data = await res.json();
      if (res.ok) {
        setCampaignSongSaved(true);
        setTimeout(() => setCampaignSongSaved(false), 1500);
        onCharacterUpdate({ campaignSongUrl: data.videoId || "", campaignSongAutoplay });
        if (data.videoId) setCampaignSongUrl(data.videoId);
      } else {
        setCampaignSongMsg({ text: data.error ?? t("common.saveFailed"), ok: false });
      }
    } catch {
      setCampaignSongMsg({ text: t("common.networkError"), ok: false });
    } finally {
      setCampaignSongSaving(false);
      setTimeout(() => setCampaignSongMsg(null), 3000);
    }
  };

  return (
    <>
      <p className="text-sm text-muted mb-6">{t("campaignSong.intro")}</p>
      <form onSubmit={handleCampaignSongSave} className="space-y-4">
        <div>
          <label htmlFor="campaignSongUrl" className="block text-sm font-medium mb-1.5">
            {t("campaignSong.urlLabel")}
          </label>
          <input
            id="campaignSongUrl"
            type="text"
            value={campaignSongUrl}
            onChange={(e) => setCampaignSongUrl(e.target.value)}
            placeholder={t("campaignSong.urlPlaceholder")}
            className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
              campaignSongUrl && campaignSongValidation.valid
                ? "border-success/60 focus:ring-success/30 bg-background"
                : campaignSongUrl && !campaignSongValidation.valid
                  ? "border-error/60 focus:ring-error/30 bg-background"
                  : "border-card-border focus:border-primary focus:ring-primary/50 bg-background"
            }`}
            disabled={campaignSongSaving}
          />
          <p className="mt-1 text-xs text-muted">{t("campaignSong.hint")}</p>
          {campaignSongUrl && !campaignSongValidation.valid && (
            <p className="mt-1 text-xs text-error">{t("campaignSong.invalid")}</p>
          )}
          {campaignSongValidation.videoId && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-card-border bg-background p-3">
              <Image
                src={`https://img.youtube.com/vi/${campaignSongValidation.videoId}/mqdefault.jpg`}
                alt={t("campaignSong.thumbAlt")}
                width={96}
                height={56}
                className="rounded-lg object-cover bg-muted/20 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs text-muted">{t("campaignSong.preview")}</p>
                <p className="text-sm font-medium text-foreground truncate">
                  youtube.com/watch?v={campaignSongValidation.videoId}
                </p>
              </div>
            </div>
          )}
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={campaignSongAutoplay}
            onChange={(e) => setCampaignSongAutoplay(e.target.checked)}
            className="h-4 w-4 rounded border-card-border bg-background text-primary focus:ring-primary"
            disabled={campaignSongSaving}
          />
          <span className="text-sm">{t("campaignSong.autoplay")}</span>
        </label>
        {campaignSongMsg && (
          <MessageBanner
            ok={campaignSongMsg.ok}
            text={campaignSongMsg.text}
            onDismiss={() => setCampaignSongMsg(null)}
          />
        )}
        <button
          type="submit"
          disabled={campaignSongSaving}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <span className="flex items-center gap-2">
            {campaignSongSaved ? <CheckIcon /> : campaignSongSaving ? <SpinnerIcon /> : null}
            {campaignSongSaved
              ? t("common.saved")
              : campaignSongSaving
                ? t("common.saving")
                : t("campaignSong.save")}
          </span>
        </button>
      </form>
    </>
  );
}
