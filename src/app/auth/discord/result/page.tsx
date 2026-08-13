"use client";

import Link from "next/link";
import Image from "next/image";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import RecordFingerprintOnMount from "@/components/auth/RecordFingerprintOnMount";

/** Maps the API's status/reason code to a key under auth.oauthResult. */
const RESULT_KEYS: Record<string, { key: string; ok: boolean }> = {
  success: { key: "success", ok: true },
  login_success: { key: "loginSuccess", ok: true },
  error: { key: "error", ok: false },
  exchange_failed: { key: "exchangeFailed", ok: false },
  missing_params: { key: "sessionExpired", ok: false },
  access_denied: { key: "accessDenied", ok: false },
  already_linked: { key: "alreadyLinked", ok: false },
  invalid_state: { key: "sessionExpired", ok: false },
  session_expired: { key: "sessionInterrupted", ok: false },
  rate_limited: { key: "rateLimited", ok: false },
  not_configured: { key: "notConfigured", ok: false },
  test_mode: { key: "testMode", ok: false },
};

const DEFAULT_NEXT = "/settings";
const PROVIDER = "Discord";

export default function DiscordAuthResultPage() {
  const t = useTranslations("auth.oauthResult");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [countdown, setCountdown] = useState(3);

  const status = searchParams.get("status") ?? "error";
  const reason = searchParams.get("reason");
  const next = searchParams.get("next") ?? DEFAULT_NEXT;

  const resolved = (reason ? RESULT_KEYS[reason] : RESULT_KEYS[status]) ?? RESULT_KEYS.error;
  const info = {
    ok: resolved.ok,
    title: t(`${resolved.key}.title`, { provider: PROVIDER }),
    message: t(`${resolved.key}.message`, { provider: PROVIDER }),
  };

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          window.location.href = next;
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [next, router]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      {info.ok && <RecordFingerprintOnMount />}
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <Image
          src={CDN_LOGO_URL}
          unoptimized
          alt={t("logoAlt")}
          width={36}
          height={36}
          className="object-contain"
        />
        <span className="text-base font-semibold tracking-tight">A House Divided</span>
      </Link>

      <div
        className={`w-full max-w-md rounded-2xl border p-8 text-center ${
          info.ok ? "border-success/30 bg-success/5" : "border-error/30 bg-error/5"
        }`}
      >
        <div
          className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${
            info.ok ? "bg-success/20" : "bg-error/20"
          }`}
        >
          {info.ok ? (
            <svg
              className="h-8 w-8 text-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            <svg
              className="h-8 w-8 text-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          )}
        </div>
        <h1 className="text-xl font-bold">{info.title}</h1>
        <p className="mt-2 text-muted">{info.message}</p>
        <p className="mt-4 text-sm text-muted">{t("redirecting", { seconds: countdown })}</p>
        <Link
          href={next}
          className="mt-6 inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("continueNow")}
        </Link>
      </div>
    </div>
  );
}
