import Link from "next/link";
import { useTranslations } from "next-intl";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { SectionHeader } from "./ProfileMeters";
import { PROFILE_LINK_CLASS } from "./profileStyles";

export interface CeoCorporationCardProps {
  corporationName: string;
  corporationRouteId: string;
  logoUrl?: string;
  isNationalEnterprise?: boolean;
}

export function CeoCorporationCard({
  corporationName,
  corporationRouteId,
  logoUrl,
  isNationalEnterprise,
}: CeoCorporationCardProps) {
  const t = useTranslations("profile.ceo");
  const href = `/corporation/${corporationRouteId}`;

  return (
    <section>
      <SectionHeader level="aside">{t("title")}</SectionHeader>
      <div className="flex gap-3">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-card-border bg-card-elevated">
          <CorporationLogo logoUrl={logoUrl} name={corporationName} fill className="rounded-md" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-body-sm font-medium leading-snug text-foreground">
            {corporationName}
          </p>
          {isNationalEnterprise && (
            <p className="mt-0.5 text-body-sm text-muted">{t("nationalEnterprise")}</p>
          )}
          <Link href={href} className={`mt-1.5 inline-block text-body-sm ${PROFILE_LINK_CLASS}`}>
            {t("viewCorporation")}
          </Link>
        </div>
      </div>
    </section>
  );
}
