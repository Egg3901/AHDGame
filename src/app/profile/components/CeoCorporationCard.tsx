import Link from "next/link";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";

export interface CeoCorporationCardProps {
  corporationName: string;
  corporationRouteId: string;
  logoUrl?: string;
  brandColor?: string;
  isNationalEnterprise?: boolean;
}

export function CeoCorporationCard({
  corporationName,
  corporationRouteId,
  logoUrl,
  brandColor,
  isNationalEnterprise,
}: CeoCorporationCardProps) {
  const href = `/corporation/${corporationRouteId}`;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-3">
        Chief Executive
      </h2>
      <div className="flex gap-3">
        <div
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-card-border bg-card-elevated"
          style={brandColor ? { borderColor: `${brandColor}55` } : undefined}
        >
          <CorporationLogo logoUrl={logoUrl} name={corporationName} fill className="rounded-lg" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground leading-snug break-words">{corporationName}</p>
          {isNationalEnterprise && (
            <p className="mt-0.5 text-body-xs text-muted">National enterprise</p>
          )}
          <Link
            href={href}
            className="mt-2 inline-block text-body-sm font-medium text-primary hover:underline"
          >
            View corporation
          </Link>
        </div>
      </div>
    </div>
  );
}
