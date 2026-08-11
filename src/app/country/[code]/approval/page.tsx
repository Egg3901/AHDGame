import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { loadNationalMetrics } from "@/lib/country/nationalMetrics";
import { loadNationalApproval } from "@/lib/country/nationalApproval";
import ApprovalClient from "./ApprovalClient";

// Server component: load the national metrics + approval payloads with direct DB
// calls and hand them to the client as initial props. This removes the old
// shell → useEffect → fetch → setState round trip (Cloudflare → Railway → Mongo)
// that every navigation to this page used to pay. The client keeps its fetch
// path for retries; it just no longer needs it for the first paint.
export default async function ApprovalPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const rawCode = code?.toUpperCase() ?? "US";
  const countryId = (rawCode in COUNTRY_CONFIGS ? rawCode : "US") as CountryId;

  // Best-effort: a DB hiccup here must not blank the page — fall back to the
  // client fetch (initial* undefined → the client shows its spinner + loads).
  const [metrics, approval] = await Promise.all([
    loadNationalMetrics(countryId).catch(() => null),
    loadNationalApproval(countryId).catch(() => null),
  ]);

  return <ApprovalClient initialMetrics={metrics} initialApproval={approval} />;
}
