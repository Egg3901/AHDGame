"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Avatar } from "@/components/Avatar";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface ImperialData {
  name: string;
  title: string;
  fullName: string;
  royalHouse: string;
  avatarUrl?: string;
  coatOfArmsUrl?: string;
  borderKey?: string;
  tintColor?: string;
  sequentialId: number;
}

/**
 * Displays the imperial head of state on the country overview stats strip.
 * Fetches from /api/imperial-characters?countryId=... and renders an avatar card
 * linking to the imperial profile page. Falls back to a plain dash if no
 * imperial character exists.
 */
export default function ImperialHeadOfState({ countryId }: { countryId: string }) {
  const [data, setData] = useState<ImperialData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/imperial-characters?countryId=${countryId}`)
      .then((r) => r.json())
      .then((json) => {
        setData(json.imperial);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [countryId]);

  if (loading) {
    return (
      <div className="flex flex-col px-5 py-3 min-w-max">
        <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
          Head of State
        </span>
        <span className="text-base font-bold text-muted">—</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col px-5 py-3 min-w-max">
        <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
          Head of State
        </span>
        <span className="text-base font-bold tabular-nums">—</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col px-5 py-3 min-w-max">
      <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
        Head of State
      </span>
      <Link
        href={`/imperial/${data.sequentialId}`}
        className="flex items-center gap-2.5 mt-1 group"
      >
        <div className="relative">
          <Avatar
            url={data.avatarUrl}
            name={data.fullName}
            size="h-9 w-9"
            borderKey={data.borderKey}
            tintColor={data.tintColor}
          />
          {data.coatOfArmsUrl && (
            <Image
              src={data.coatOfArmsUrl}
              alt="Coat of Arms"
              width={16}
              height={16}
              className="absolute -bottom-1 -right-1 w-4 h-4 rounded-sm border border-background object-cover"
              unoptimized={bypassNextImageOptimization(data.coatOfArmsUrl)}
            />
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold group-hover:text-primary transition-colors">
            {data.fullName}
          </span>
          <span className="text-[10px] text-muted">{data.royalHouse}</span>
        </div>
      </Link>
    </div>
  );
}
