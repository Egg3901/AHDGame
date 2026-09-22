export type PlatformEventType = "turn:completed" | "turn:failed";

export interface PlatformEvent {
  type: PlatformEventType;
  source: "ahd";
  id: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface PublishOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  token?: string;
  attempts?: number;
}

export async function publishPlatformEvent(
  event: PlatformEvent,
  options: PublishOptions = {}
): Promise<boolean> {
  const url = options.url ?? process.env.PLATFORM_EVENT_URL;
  const token = options.token ?? process.env.PLATFORM_EVENT_TOKEN;
  if (!url || !token) return false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return true;
    } catch {
      // The existing turn result remains authoritative when the optional bus is down.
    }
  }
  console.warn("[platform-events] delivery failed", { type: event.type, id: event.id, attempts });
  return false;
}
