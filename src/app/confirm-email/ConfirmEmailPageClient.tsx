"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { Button, SectionLabel } from "@/components/ui";
import { apiErrorText } from "@/lib/errors/catalog";

export default function ConfirmEmailPageClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmedEmail, setConfirmedEmail] = useState("");

  // Confirmation is a deliberate click, not an on-load POST, so mail scanners
  // that open links cannot burn the token before the player does.
  const handleConfirm = async () => {
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/confirm-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(apiErrorText(data, "Confirmation failed. Please try again."));
      }
      setConfirmedEmail(data.email ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const linkCls =
    "font-medium text-primary transition-colors hover:text-primary-dark link-underline";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="relative mx-auto w-full max-w-md">
        <Link href="/" className="mb-5 flex items-center gap-2.5 sm:mb-7">
          <Image
            src={CDN_LOGO_URL}
            unoptimized
            alt="A House Divided Logo"
            width={36}
            height={36}
            className="object-contain"
          />
          <span className="text-body-lg font-semibold tracking-tight">A House Divided</span>
        </Link>

        <section className="relative overflow-hidden rounded-xl border border-card-border bg-card p-5 shadow-panel sm:p-8">
          <div className="mb-7 border-b border-card-border pb-6">
            <SectionLabel as="p">Account</SectionLabel>
            <h1 className="mt-1 text-display font-semibold tracking-tight text-foreground">
              Confirm email
            </h1>
          </div>

          {confirmedEmail ? (
            <>
              <p className="text-body text-foreground">
                Your account email is now {confirmedEmail}.
              </p>
              <p className="mt-8 text-center text-body text-muted">
                <Link href="/settings" className={linkCls}>
                  Go to settings
                </Link>
              </p>
            </>
          ) : !token ? (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-body text-error"
            >
              This confirmation link is missing its token.
            </div>
          ) : (
            <>
              {error && (
                <div
                  role="alert"
                  className="mb-6 flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-body text-error"
                >
                  {error}
                </div>
              )}
              <p className="mb-6 text-body text-muted">
                Confirm to make this address the email on your account.
              </p>
              <Button onClick={handleConfirm} isLoading={isLoading} size="lg" className="w-full">
                Confirm email
              </Button>
              <p className="mt-8 text-center text-body text-muted">
                <Link href="/settings" className={linkCls}>
                  Back to settings
                </Link>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
