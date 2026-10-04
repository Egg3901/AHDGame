"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorPageContent } from "@/components/ui/ErrorPageContent";
import { claimNetworkRetry, clearNetworkRetry, isNetworkFetchFailure } from "./routeErrorRecovery";

interface CountryErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CountryError({ error, reset }: CountryErrorProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("layout");
  const pendingRetryRoute = useRef<string | null>(null);
  const [reportFailure, setReportFailure] = useState(false);
  const isNetworkFailure = isNetworkFetchFailure(error);
  const routeKey = pathname ?? "/country";

  useEffect(() => {
    if (!isNetworkFailure) {
      pendingRetryRoute.current = null;
      return;
    }

    if (pendingRetryRoute.current === routeKey || claimNetworkRetry(routeKey)) {
      pendingRetryRoute.current = routeKey;
      // RSC body-stream errors can arrive after fetch headers succeeded. Next's
      // reset alone replays the same rejected Flight payload; refresh requests a
      // fresh payload before clearing the route boundary.
      const timer = window.setTimeout(() => {
        pendingRetryRoute.current = null;
        router.refresh();
        reset();
      }, 0);
      return () => window.clearTimeout(timer);
    }

    // The one automatic retry failed. Keep the explicit offline UI and report
    // this persistent transport failure through ErrorPageContent's Sentry hook.
    const timer = window.setTimeout(() => setReportFailure(true), 0);
    return () => window.clearTimeout(timer);
  }, [error, isNetworkFailure, reset, routeKey, router]);

  if (isNetworkFailure && !reportFailure) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
        <div role="status" aria-live="polite" className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold text-foreground">
            {t("error.networkRetryingTitle")}
          </h1>
          <p className="text-sm text-muted">{t("error.networkRetryingDescription")}</p>
        </div>
      </main>
    );
  }

  const retryManually = () => {
    clearNetworkRetry(routeKey);
    router.refresh();
    reset();
  };

  return (
    <ErrorPageContent
      error={error}
      reset={retryManually}
      logPrefix="App error"
      title={isNetworkFailure ? t("error.networkFailureTitle") : undefined}
      description={isNetworkFailure ? t("error.networkFailureDescription") : undefined}
      navigationLinks={[{ href: "/", label: "Go home" }]}
      fullScreen
    />
  );
}
