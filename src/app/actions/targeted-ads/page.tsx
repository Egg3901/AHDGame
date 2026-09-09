"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TargetedAdsPanel } from "@/app/campaign/[id]/components/TargetedAdsPanel";

export default function TargetedAdsActionPage() {
  const router = useRouter();
  const t = useTranslations("elections.campaignTargeting");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/character", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        router.push("/login");
        return;
      }
      if (!response.ok) throw new Error("Character unavailable");
      setReady(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [router]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold text-foreground">{t("title")}</h1>
      <p className="mt-2 mb-6 text-muted">{t("standingDescription")}</p>
      {failed && (
        <p role="alert" className="text-error">
          {t("loadCharacterFailed")}
        </p>
      )}
      {ready && <TargetedAdsPanel onResourcesSpent={refresh} />}
      <Link href="/actions" className="mt-6 block text-primary">
        {t("backToActions")}
      </Link>
    </main>
  );
}
