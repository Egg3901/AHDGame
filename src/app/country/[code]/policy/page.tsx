import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { loadNationalPolicyRecords } from "@/lib/policy/nationalPolicyRecordsList";
import { loadPolicyRecordPayload } from "@/lib/policy/policyRecordPayload";
import type { RecordPayload } from "./components/policyView";
import PolicyClient from "./PolicyClient";

// Server component: load the national policy records + record payload with direct
// DB calls and hand them to the client as initial props, removing the old
// shell → useEffect → fetch → setState round trip through Cloudflare → Railway.
// The social-axis strip stays a client fetch (it is auth-gated and per-session),
// and the client keeps its fetch path for retries.
export default async function PolicyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const countryId = code?.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    // Preserve the client's behavior for unknown codes (it renders null); with
    // no seed the client falls back to its own fetch + guards.
    return <PolicyClient />;
  }

  // Best-effort: a DB hiccup must not blank the page. On failure the client
  // falls back to its own fetch (records seed → [] keeps loading spinner off is
  // undesirable, so pass undefined to let the client fetch instead).
  const [records, recordPayload] = await Promise.all([
    loadNationalPolicyRecords(countryId).catch(() => null),
    loadPolicyRecordPayload(countryId).catch(() => null),
  ]);

  // Only seed when the records load succeeded; otherwise let the client fetch so
  // a transient server error still recovers on the client (and shows the spinner).
  if (records === null) {
    return <PolicyClient />;
  }

  // The record loader returns the timeline in the engine's own point/event types;
  // the client consumes the same JSON shape as RecordPayload (this is the exact
  // cast that previously happened across the fetch boundary).
  return (
    <PolicyClient
      initialRecords={records}
      initialRecordPayload={recordPayload as RecordPayload | null}
    />
  );
}
