/**
 * Admin: regime override panel for a one-party state.
 *
 * Renders three forms (force-stage, set-scalar, force-conversion) plus
 * a read-only view of the country's escalation state + recent
 * transitions. Admin auth is enforced at the route level; this page
 * additionally redirects non-admins to /dashboard.
 *
 * Browser checklist note: navigate to /admin/country/CN/regime as an
 * admin user to verify forms POST successfully and history updates.
 */
import { redirect } from "next/navigation";
import { getAuthAdmin } from "@/lib/auth";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { notFound } from "next/navigation";
import { AdminRegimePanel } from "./AdminRegimePanel";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function AdminRegimePage({ params }: Props) {
  const user = await getAuthAdmin();
  if (!user) redirect("/dashboard");

  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-card-border bg-card">
        <div className="mx-auto max-w-7xl px-4 py-5">
          <h1 className="text-lg font-bold text-foreground">
            Regime override panel — {COUNTRY_CONFIGS[countryId].name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Admin-only. Each action writes to the country&apos;s regime-escalation history with an
            <code className="mx-1 rounded bg-card-border/40 px-1">admin override</code>
            tag for audit.
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <AdminRegimePanel countryCode={countryId} />
      </div>
    </div>
  );
}
