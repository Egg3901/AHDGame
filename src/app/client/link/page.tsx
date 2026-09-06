import Link from "next/link";
import { getAuthUser } from "@/lib/auth";

export default async function ClientLinkPage() {
  const user = await getAuthUser();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            A House Divided
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Link your desktop client</h1>
          <p className="mt-4 text-muted">
            Sign in to connect this browser session to the AHD desktop client.
          </p>
          <Link
            // The account service only accepts its own explicit continuation
            // URLs. A nested `/client/link` return is rejected there before a
            // desktop WebView can receive the session cookie.
            href="/login"
            className="mt-6 inline-flex rounded-xl bg-primary px-5 py-2.5 font-medium text-primary-foreground"
          >
            Sign in to continue
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <section className="w-full max-w-lg rounded-2xl border border-success/30 bg-card p-8 text-center shadow-sm">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-2xl text-success"
          aria-hidden="true"
        >
          ✓
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Desktop client linked</h1>
        <p className="mt-3 text-muted">
          You are signed in as {user.username}. You can return to the desktop client now.
        </p>
      </section>
    </main>
  );
}
