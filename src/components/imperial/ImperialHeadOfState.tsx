"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Avatar } from "@/components/Avatar";
import { Skeleton } from "@/components/ui";
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
 * Displays the imperial head of state among the country overview's header
 * figures: a small muted label over the monarch's avatar and name, linking to
 * the imperial profile page. Reads "None on record" when no imperial character
 * exists.
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
      <div className="flex min-w-max flex-col">
        <span className="text-body-sm text-muted">Head of state</span>
        <div className="mt-1 flex h-7 items-center gap-2" aria-hidden>
          <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-w-max flex-col">
        <span className="text-body-sm text-muted">Head of state</span>
        <span className="mt-1 text-body-lg text-muted">None on record</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-max flex-col">
      <span className="text-body-sm text-muted">Head of state</span>
      <Link href={`/imperial/${data.sequentialId}`} className="group mt-1 flex items-center gap-2">
        <div className="relative">
          <Avatar
            url={data.avatarUrl}
            name={data.fullName}
            size="h-8 w-8"
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
          <span className="text-body-lg font-semibold text-foreground underline-offset-4 group-hover:underline">
            {data.fullName}
          </span>
          <span className="text-body-sm text-muted">{data.royalHouse}</span>
        </div>
      </Link>
    </div>
  );
}
