"use client";
import { useTranslations } from "next-intl";
export function MonetaryAuthorityNotice({ name }: { name: string }) {
  const t = useTranslations("centralBank");
  return <p className="text-sm text-muted">{t("monetaryAuthority", { name })}</p>;
}
