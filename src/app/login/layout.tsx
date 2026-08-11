import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Login | A House Divided",
  description:
    "Log in to A House Divided and continue your political career in this real-time political simulation game.",
};

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-pulse rounded-full bg-primary/20" aria-hidden />
    </div>
  );
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoginFallback />}>{children}</Suspense>;
}
