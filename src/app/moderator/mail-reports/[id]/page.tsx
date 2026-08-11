import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthModerator } from "@/lib/auth";
import { MailReportViewClient } from "@/components/moderator/MailReportViewClient";

interface MailReportPageProps {
  params: Promise<{ id: string }>;
}

export default async function ModeratorMailReportPage({ params }: MailReportPageProps) {
  const user = await getAuthModerator();
  if (!user) redirect("/dashboard");

  const { id } = await params;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-card-border bg-card shadow-sm">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Staff review</p>
          <h1 className="text-lg font-bold text-foreground">Reported conversation</h1>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Suspense
          fallback={<p className="py-12 text-center text-sm text-muted">Loading conversation…</p>}
        >
          <MailReportViewClient reportId={id} />
        </Suspense>
      </div>
    </div>
  );
}
