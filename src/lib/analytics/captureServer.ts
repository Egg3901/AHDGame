/** Server events use the same event name and properties at both destinations. */
export async function captureServerProductEvent(
  event: string,
  properties: Record<string, string | number | boolean>
): Promise<void> {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const amplitudeKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  const distinctId = "system:turn-processor";
  await Promise.allSettled([
    posthogKey
      ? fetch("https://us.i.posthog.com/capture/", {
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
}
