import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { MaintenanceCountdown } from "@/app/maintenance/MaintenanceCountdown";
import { COMMUNITY_DISCORD_URL } from "@/lib/communityLinks";
import { IntakeBlockedBeacon } from "./IntakeBlockedBeacon";

/**
 * Shown in place of a signup or character-creation form while that path is
 * closed, so nobody fills in a form the server is going to refuse.
 */
export function IntakeClosedPanel({
  title,
  body,
  expectedEnd,
  surface,
  reason,
  actions,
}: {
  title: string;
  body: ReactNode;
  expectedEnd: string | null;
  /** Analytics label for which page showed the panel. */
  surface: "register" | "create_character";
  reason: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-foreground">
      <IntakeBlockedBeacon surface={surface} reason={reason} />
      <div className="w-full max-w-lg text-center">
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image src={CDN_LOGO_URL} unoptimized alt="A House Divided" width={64} height={64} />
          </Link>
        </div>
        <h1 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        <div className="mb-6 text-sm leading-relaxed text-muted sm:text-base">{body}</div>
        {expectedEnd && <MaintenanceCountdown expectedEnd={expectedEnd} />}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          {actions}
          <a
            href={COMMUNITY_DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[#5865F2] px-5 text-sm font-medium text-white transition-colors hover:bg-[#4752C4]"
          >
            Get notified on Discord
          </a>
        </div>
      </div>
    </div>
  );
}
