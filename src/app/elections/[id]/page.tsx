import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { resolveElection } from "@/lib/elections/resolveElection";
import { ElectionDetailClient } from "./components/ElectionDetailClient";
import type { ElectionDetail } from "./components/ElectionDetailTypes";

// Per-user: `resolveElection` applies fog-of-war and marks the viewer's own
// candidacy, so this render must never be cached or shared between viewers.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cycle?: string }>;
}

/**
 * Server shell. It loads the election once so the first paint is real content
 * rather than the skeleton — the page used to be client-only, so every visit
 * showed a loading state while the browser made its own round trip. The client
 * takes over for polling, entering, and withdrawing.
 *
 * A failure here is not fatal: `initialElection` goes null and the client falls
 * back to its own fetch, which is exactly the old behaviour.
 */
export default async function ElectionDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { cycle: cycleParam } = await searchParams;

  let initialElection: ElectionDetail | null = null;
  try {
    const db = await getDb();
    const user = await getAuthUser();
    const parsedCycle = cycleParam ? parseInt(cycleParam, 10) : undefined;
    const cycle = parsedCycle !== undefined && !isNaN(parsedCycle) ? parsedCycle : undefined;

    const result = await resolveElection(
      db,
      id,
      {
        view: "full",
        userId: user?.userId ?? null,
        isAdmin: user?.isAdmin ?? false,
        activeCharacterId: user?.activeCharacterId ?? null,
      },
      cycle
    );

    if (result) {
      // The API wraps candidates under `candidates`; the client reads
      // `allCandidates`. Same remap the client fetch does.
      // JSON round-trip so the client receives byte-identical data to the
      // polled API response — Dates become ISO strings, and any stray ObjectId
      // becomes a string instead of failing RSC serialization.
      const resolved = JSON.parse(JSON.stringify(result)) as ElectionDetail & {
        candidates: ElectionDetail["allCandidates"];
      };
      initialElection = { ...resolved, allCandidates: resolved.candidates };
    }
  } catch {
    // Non-fatal — the client refetches and renders its own error state.
    initialElection = null;
  }

  return <ElectionDetailClient id={id} initialElection={initialElection} />;
}
