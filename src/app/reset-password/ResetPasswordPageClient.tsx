"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { Input, Label, Button, SectionLabel } from "@/components/ui";

export default function ResetPasswordPageClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [tokenRejected, setTokenRejected] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 400 && !data.error?.includes("Password")) {
          setTokenRejected(true);
        }
        throw new Error(data.error || "Reset failed. Please try again.");
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

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

        <section className="relative overflow-hidden rounded-xl border border-card-border bg-card/90 p-5 shadow-panel backdrop-blur-sm sm:p-8">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-primary/40 to-transparent"
          />

          <div className="mb-7 border-b border-card-border pb-6">
            <SectionLabel as="p">Account</SectionLabel>
            <h1 className="mt-1 font-display text-display font-semibold tracking-tight text-foreground">
              Reset password
            </h1>
            <p className="mt-2 text-body text-muted">Choose a new password for your account.</p>
          </div>

          {success ? (
            <>
              <p className="text-body text-foreground">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <p className="mt-8 text-center text-body text-muted">
                <Link
                  href="/login"
                  className="font-medium text-primary transition-colors hover:text-primary-dark link-underline"
                >
                  Go to login
                </Link>
              </p>
            </>
          ) : !token || tokenRejected ? (
            <>
              <div
                role="alert"
                className="mb-6 flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-body text-error"
              >
                {tokenRejected
                  ? "This reset link is invalid or has expired."
                  : "This reset link is missing its token."}
              </div>
              <p className="text-center text-body text-muted">
                <Link
                  href="/forgot-password"
                  className="font-medium text-primary transition-colors hover:text-primary-dark link-underline"
                >
                  Request a new reset link
                </Link>
              </p>
            </>
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

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="bg-card-muted"
                  />
                </div>

                <div>
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your new password"
                    className="bg-card-muted"
                  />
                </div>

                <Button
                  type="submit"
                  isLoading={isLoading}
                  size="lg"
                  className="w-full shadow-glow-sm transition-shadow hover:shadow-glow"
                >
                  Reset password
                </Button>
              </form>

              <p className="mt-8 text-center text-body text-muted">
                <Link
                  href="/login"
                  className="font-medium text-primary transition-colors hover:text-primary-dark link-underline"
                >
                  Back to login
                </Link>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
