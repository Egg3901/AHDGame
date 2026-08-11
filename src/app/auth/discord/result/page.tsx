"use client";

import Link from "next/link";
import Image from "next/image";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import RecordFingerprintOnMount from "@/components/auth/RecordFingerprintOnMount";

const MESSAGES: Record<string, { title: string; message: string; ok: boolean }> = {
  success: {
    title: "Discord linked!",
    message: "Your Discord account has been linked successfully.",
    ok: true,
  },
  login_success: {
    title: "Signed in with Discord!",
    message: "You're now signed in. Redirecting you...",
    ok: true,
  },
  error: {
    title: "Something went wrong",
    message: "Discord linking failed. Please try again.",
    ok: false,
  },
  exchange_failed: {
    title: "Connection failed",
    message: "Discord authentication failed. Please try again.",
    ok: false,
  },
  missing_params: {
    title: "Session expired",
    message: "Your session expired. Please try again.",
    ok: false,
  },
  access_denied: {
    title: "Authorization denied",
    message: "You cancelled the Discord authorization.",
    ok: false,
  },
  already_linked: {
    title: "Already linked",
    message: "This Discord account is already linked to another user.",
    ok: false,
  },
  invalid_state: {
    title: "Session expired",
    message: "Your session expired. Please try again.",
    ok: false,
  },
  session_expired: {
    title: "Session expired",
    message: "Your session expired or was interrupted. Please try again.",
    ok: false,
  },
  rate_limited: {
    title: "Too many attempts",
    message: "You're sending requests too quickly. Please wait a moment and try again.",
    ok: false,
  },
  not_configured: {
    title: "Not configured",
    message: "Discord linking is not configured on this server.",
    ok: false,
  },
  test_mode: {
    title: "Test mode active",
    message:
      "This server is in test mode. New Discord registrations are disabled. Use email registration with a test secret instead.",
    ok: false,
  },
};

const DEFAULT_NEXT = "/settings";

export default function DiscordAuthResultPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [countdown, setCountdown] = useState(3);

  const status = searchParams.get("status") ?? "error";
  const reason = searchParams.get("reason");
  const next = searchParams.get("next") ?? DEFAULT_NEXT;

  const info = (reason ? MESSAGES[reason] : MESSAGES[status]) ?? MESSAGES.error;

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
          alt="A House Divided Logo"
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
        <p className="mt-4 text-sm text-muted">
          Redirecting in {countdown} second{countdown !== 1 ? "s" : ""}...
        </p>
        <Link
          href={next}
          className="mt-6 inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Continue now
        </Link>
      </div>
    </div>
  );
}
