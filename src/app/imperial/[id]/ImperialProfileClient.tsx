"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ProfilePictureLightbox } from "@/app/profile/components/ProfilePictureLightbox";
import { CampaignSongPlayer } from "@/components/CampaignSongPlayer";
import { getCountryFlagUrlForEra } from "@/lib/constants";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { PROFILE_HERO_OVERLAP_CLASSES } from "@/lib/constants/profileHeroLayout";
import type { ProfileBorderKey } from "@/lib/db/types";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface ImperialCorporation {
  id: string;
  name: string;
  type: string;
  sequentialId: number;
  sharePrice: number;
}

interface ImperialData {
  id: string;
  name: string;
  title: string;
  fullName: string;
  gender: string;
  countryId: string;
  homeState: string;
  sequentialId: number;
  royalHouse: string;
  coatOfArmsUrl?: string;
  avatarUrl?: string;
  profileHeaderImageUrl?: string;
  borderKey?: string;
  tintColor?: string;
  bio?: string;
  campaignSongUrl?: string;
  campaignSongAutoplay?: boolean;
  corporations: ImperialCorporation[];
  createdAt: string;
}

export default function ImperialProfileClient({ id }: { id: string }) {
  const preset = useActivePreset();
  const [data, setData] = useState<ImperialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/imperial-characters/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((json) => {
        setData(json.imperial);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted">Imperial character not found.</p>
      </div>
    );
  }

  const flagUrl = getCountryFlagUrlForEra(data.countryId, preset);

  return (
    <div className="mx-auto max-w-4xl pb-16">
      {/* Hero / Header Image */}
      <div className="relative h-40 overflow-hidden rounded-t-2xl bg-gradient-to-br from-primary/20 to-primary/5 sm:h-56">
        {data.profileHeaderImageUrl ? (
          <Image
            src={data.profileHeaderImageUrl}
            alt=""
            fill
            className="object-cover"
            priority
            unoptimized={bypassNextImageOptimization(data.profileHeaderImageUrl)}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-amber-900/30 via-primary/10 to-amber-800/20" />
        )}
      </div>

      {/* Overlap row */}
      <div
        className={`relative z-10 px-4 pb-5 pt-0 sm:px-6 lg:px-8 ${PROFILE_HERO_OVERLAP_CLASSES}`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-row items-end gap-3 sm:gap-6">
            {/* Avatar */}
            <div className="shrink-0">
              <div
                className={
                  data.borderKey
                    ? "rounded-2xl bg-transparent p-0 shadow-xl ring-0 sm:p-0"
                    : "rounded-2xl bg-card p-0.5 shadow-xl ring-1 ring-card-border sm:p-1"
                }
              >
                <ProfilePictureLightbox
                  avatarUrl={data.avatarUrl}
                  characterName={data.fullName}
                  borderKey={(data.borderKey as ProfileBorderKey) ?? null}
                  tintColor={data.tintColor}
                />
              </div>
            </div>

            {/* Name + badges */}
            <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-lg font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
                  {data.fullName}
                </h1>
                {/* Admin chip */}
                <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning sm:px-2 sm:text-[10px]">
                  Admin
                </span>
                {/* Imperial chip */}
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400 sm:px-2 sm:text-[10px]">
                  {data.title}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted sm:text-sm">
                {flagUrl && (
                  <Image
                    src={flagUrl}
                    alt={data.countryId}
                    width={20}
                    height={14}
                    className="rounded-sm"
                    unoptimized={bypassNextImageOptimization(flagUrl)}
                  />
                )}
                <span>{data.royalHouse}</span>
              </div>
            </div>
          </div>

          {/* Coat of Arms (desktop) */}
          {data.coatOfArmsUrl && (
            <div className="hidden sm:block shrink-0">
              <Image
                src={data.coatOfArmsUrl}
                alt="Coat of Arms"
                width={80}
                height={80}
                className="rounded-lg border border-card-border shadow-md"
                unoptimized={bypassNextImageOptimization(data.coatOfArmsUrl)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-6 px-4 sm:px-6 lg:px-8">
        {/* Coat of Arms (mobile) */}
        {data.coatOfArmsUrl && (
          <div className="flex justify-center sm:hidden">
            <Image
              src={data.coatOfArmsUrl}
              alt="Coat of Arms"
              width={80}
              height={80}
              className="rounded-lg border border-card-border shadow-md"
              unoptimized={bypassNextImageOptimization(data.coatOfArmsUrl)}
            />
          </div>
        )}

        {/* Bio */}
        {data.bio && (
          <div className="rounded-2xl border border-card-border bg-card p-4 sm:p-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              Biography
            </h2>
            <p className="text-sm leading-relaxed text-foreground/80">{data.bio}</p>
          </div>
        )}

        {/* Corporation Holdings */}
        {data.corporations.length > 0 && (
          <div className="rounded-2xl border border-card-border bg-card p-4 sm:p-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
              Royal Holdings
            </h2>
            <div className="space-y-2">
              {data.corporations.map((corp) => (
                <Link
                  key={corp.id}
                  href={`/corporation/${corp.sequentialId}`}
                  className="flex items-center justify-between rounded-xl border border-card-border bg-background/50 px-4 py-3 transition-colors hover:bg-card-hover"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{corp.name}</p>
                    <p className="text-xs text-muted capitalize">{corp.type.replace(/_/g, " ")}</p>
                  </div>
                  <p className="text-sm font-medium tabular-nums text-foreground">
                    ${corp.sharePrice.toFixed(2)}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Campaign Song */}
        {data.campaignSongUrl && (
          <div className="rounded-2xl border border-card-border bg-card p-4 sm:p-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
              Royal Anthem
            </h2>
            <CampaignSongPlayer
              videoId={data.campaignSongUrl}
              ownerAutoplay={data.campaignSongAutoplay ?? false}
              viewerDisablesAutoplay={false}
              characterName={data.fullName}
            />
          </div>
        )}
      </div>
    </div>
  );
}
