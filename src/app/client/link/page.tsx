import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getAuthUser } from "@/lib/auth";
import { ClientLinkStatus } from "./ClientLinkStatus";

export default async function ClientLinkPage() {
  const user = await getAuthUser();
  const t = await getTranslations("auth.clientLink");
  const userAgent = (await headers()).get("user-agent") ?? "";
  const device = /AHDClient-Mobile\/|AHD-Android|Android|iPhone|iPad|iPod/i.test(userAgent)
    ? "mobile"
    : "desktop";

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            A House Divided
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {t("signInTitle", { device })}
          </h1>
          <p className="mt-4 text-muted">{t("signInDescription", { device })}</p>
          <Link
            // The account service only accepts its own explicit continuation
            // URLs. A nested `/client/link` return is rejected there before a
            // client WebView can receive the session cookie.
            href="/login"
            className="mt-6 inline-flex rounded-xl bg-primary px-5 py-2.5 font-medium text-primary-foreground"
          >
            {t("signIn")}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <ClientLinkStatus device={device} username={user.username} />
    </main>
  );
}
