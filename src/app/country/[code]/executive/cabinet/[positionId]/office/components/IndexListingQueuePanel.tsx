"use client";

import Link from "next/link";
import { useState } from "react";
import { useAbortableEffectFetch } from "@/hooks/useAbortableEffectFetch";
import {
  DenseSection,
  InlineStatus,
  SmallButton,
  Td,
} from "@/components/corporation/dense/DenseKit";

interface Queue {
  seat: { seatId: string; seatName: string } | null;
  petitions: {
    id: string;
    corporationId: string;
    corporationName: string;
    filedAtTurn: number;
    deadlineAtTurn: number;
    contributionAnchor: number;
  }[];
}

export function IndexListingQueuePanel({ canAct }: { canAct: boolean }) {
  const [data, setData] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = useAbortableEffectFetch(async (signal) => {
    try {
      const res = await fetch("/api/index-petitions", { signal });
      if (!res.ok) throw new Error("Could not load index listing requests.");
      const queue: Queue = await res.json();
      if (!signal.aborted) setData(queue);
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : "Failed to load requests.");
    }
  }, []);

  async function decide(id: string, grant: boolean) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/index-petitions/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Decision failed");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setLoading(false);
    }
  }

  if (data?.seat === null || (!data && !error)) return null;

  return (
    <DenseSection title="Index listing requests">
      <div className="space-y-2 py-1 text-xs">
        {data?.seat && (
          <>
            <p className="font-medium text-foreground">
              Index listing requests waiting for you as {data.seat.seatName}
            </p>
            {data.petitions.length === 0 ? (
              <p className="text-muted">No index listing requests are waiting for you.</p>
            ) : (
              <table className="w-full border-collapse">
                <tbody>
                  {data.petitions.map((petition) => (
                    <tr key={petition.id}>
                      <Td>
                        <Link
                          href={`/corporation/${petition.corporationId}`}
                          className="text-foreground"
                        >
                          {petition.corporationName}
                        </Link>
                        <span className="ml-2 text-xs text-muted">
                          filed turn {petition.filedAtTurn}, decide by {petition.deadlineAtTurn},
                          contribution ₳
                          {Math.round(petition.contributionAnchor).toLocaleString("en-US")}
                        </span>
                      </Td>
                      <Td align="right" numeric={false}>
                        <span className="inline-flex gap-1.5">
                          <SmallButton
                            disabled={loading || !canAct}
                            onClick={() => decide(petition.id, true)}
                          >
                            Grant
                          </SmallButton>
                          <SmallButton
                            disabled={loading || !canAct}
                            onClick={() => decide(petition.id, false)}
                          >
                            Refuse
                          </SmallButton>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        <InlineStatus message={error} tone="error" />
      </div>
    </DenseSection>
  );
}
