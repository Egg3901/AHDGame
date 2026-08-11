"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { Input, Label, Button, SectionLabel } from "@/components/ui";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";

export default function ForgotPasswordPageClient() {
  const [identifier, setIdentifier] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Request failed. Please try again.");
      }
      setSubmitted(true);
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
              Forgot password
            </h1>
            <p className="mt-2 text-body text-muted">
              Enter your email or username and we will send you a reset link.
            </p>
          </div>

          {submitted ? (
            <p className="text-body text-foreground">
              If an account matches, we sent a reset link to its email and Discord (if linked). The
              link lasts 30 minutes.
            </p>
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
                  <Label htmlFor="identifier">Email or Username</Label>
                  <Input
                    id="identifier"
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="username or email@example.com"
                    className="bg-card-muted"
                  />
                </div>

                <TurnstileWidget
                  onVerify={setTurnstileToken}
                  onExpire={() => setTurnstileToken("")}
                />

                <Button
                  type="submit"
                  isLoading={isLoading}
                  size="lg"
                  className="w-full shadow-glow-sm transition-shadow hover:shadow-glow"
                >
                  Send reset link
                </Button>
              </form>
            </>
          )}

          <p className="mt-8 text-center text-body text-muted">
            Remembered it?{" "}
            <Link
              href="/login"
              className="font-medium text-primary transition-colors hover:text-primary-dark link-underline"
            >
              Back to login
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
