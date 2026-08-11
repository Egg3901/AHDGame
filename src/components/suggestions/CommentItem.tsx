"use client";

import { useState } from "react";
import Image from "next/image";
import { PlayerBadge } from "./PlayerBadge";
import type { CountryId } from "@/lib/constants/countries";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { RelativeTime } from "@/components/time/LocalTime";

interface CommentItemProps {
  _id: string;
  /** Character name (author of the comment). */
  authorName: string;
  authorAvatarUrl: string | null;
  authorParty: string | null;
  authorPartyAbbrev: string | null;
  authorStateCode: string | null;
  authorCountryId: string | null;
  authorBorderKey: string | null;
  authorTintColor: string | null;
  body: string;
  createdAt: string;
  userId: string;
  canDelete: boolean;
  onDelete: (commentId: string) => Promise<void>;
}

export function CommentItem({
  _id,
  authorName,
  authorAvatarUrl,
  authorPartyAbbrev,
  authorStateCode,
  authorCountryId,
  body,
  createdAt,
  canDelete,
  onDelete,
}: CommentItemProps) {
  const [deleting, setDeleting] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="group rounded-xl border border-card-border bg-card p-4"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3">
        {authorAvatarUrl ? (
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-card-border">
            <Image
              src={authorAvatarUrl}
              alt=""
              width={32}
              height={32}
              className="h-full w-full object-cover"
              unoptimized={bypassNextImageOptimization(authorAvatarUrl)}
            />
          </div>
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card-elevated ring-1 ring-card-border text-xs font-medium text-muted">
            {authorName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{authorName}</span>
            <PlayerBadge
              partyAbbrev={authorPartyAbbrev}
              stateCode={authorStateCode}
              countryId={authorCountryId as CountryId | null}
            />
            <RelativeTime className="text-xs text-muted" value={createdAt} />
            {canDelete && hovered && (
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  if (deleting) return;
                  setDeleting(true);
                  try {
                    await onDelete(_id);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="ml-auto text-xs text-muted hover:text-red-400 transition-colors"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{body}</p>
        </div>
      </div>
    </div>
  );
}
