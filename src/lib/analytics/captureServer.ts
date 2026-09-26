/** Server events use the same event name and properties at both destinations. */
export async function captureServerProductEvent(
  event: string,
  properties: Record<string, string | number | boolean>
): Promise<void> {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const amplitudeKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  const distinctId = "system:turn-processor";
  const results = await Promise.allSettled([
    posthogKey
      ? fetch("https://us.i.posthog.com/i/v0/e/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: posthogKey,
            event,
            distinct_id: distinctId,
            properties,
          }),
          signal: AbortSignal.timeout(2000),
        })
      : Promise.resolve(),
    amplitudeKey
      ? fetch("https://api2.amplitude.com/2/httpapi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: amplitudeKey,
            events: [{ user_id: distinctId, event_type: event, event_properties: properties }],
          }),
          signal: AbortSignal.timeout(2000),
        })
      : Promise.resolve(),
  ]);
  for (const [index, result] of results.entries()) {
    const response = result.status === "fulfilled" ? result.value : undefined;
    if (result.status === "rejected" || (response && !response.ok)) {
      console.warn(
        `[Analytics] ${index === 0 ? "PostHog" : "Amplitude"} rejected ${event}: ${
          response ? response.status : "network error"
        }`
      );
    }
  }
}
