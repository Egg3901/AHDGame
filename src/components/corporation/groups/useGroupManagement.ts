"use client";
import { useCallback, useEffect, useState } from "react";
import type { groupManagementView } from "@/lib/corporations/groups/management";
import type { GroupManagementCommand } from "@/lib/corporations/groups/managementSchema";
export type GroupManagementView = NonNullable<Awaited<ReturnType<typeof groupManagementView>>>;
export function useGroupManagement(corpId: string) {
  const [data, setData] = useState<GroupManagementView | null>(null),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/corporations/" + corpId + "/group/management", { signal });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Unable to load group management.");
        setData(payload.management);
      } catch (e) {
        if (!signal?.aborted)
          setError(e instanceof Error ? e.message : "Unable to load group management.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [corpId]
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/corporations/" + corpId + "/group/management", { signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Unable to load group management.");
        return payload.management as GroupManagementView | null;
      })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setData(payload);
          setError("");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Unable to load group management.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [corpId]);
  async function save(command: GroupManagementCommand, targetId = corpId) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/corporations/" + targetId + "/group/management", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Unable to save group settings.");
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save group settings.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { data, loading, error, busy, save, refresh };
}
