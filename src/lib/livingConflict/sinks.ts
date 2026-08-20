import type { BroadcastSink, PublishedMessage } from "./broadcast";
import type { BroadcastChannel, EventSeverity } from "./types";

/**
 * Broadcast sinks: the concrete destinations the bus delivers to. The collecting
 * sink is for tests and dry-runs. The wire and Discord factories are the real
 * integration points; they are deliberately thin adapters so the bus stays pure
 * and the side-effecting call lives in one obvious place per channel.
 */

/** Records everything delivered; used by tests and by a dry-run preview. */
export function collectingSink(
  channel: BroadcastChannel,
  minSeverity: EventSeverity = "minor"
): BroadcastSink & { messages: PublishedMessage[] } {
  const messages: PublishedMessage[] = [];
  return {
    channel,
    minSeverity,
    messages,
    async deliver(message) {
      messages.push(message);
    },
  };
}

/**
 * In-game news wire sink. The real adapter calls the existing wire publisher
 * (the same path `announceCrisisStart` / `announceVietnamMove` use). Wired at
 * integration time; kept a factory so the bus never imports the wire directly.
 *
 * @param publish - inject the wire publisher: (nation|null, headline, body) => void
 */
export function makeWireSink(
  channel: Extract<BroadcastChannel, "wire_global" | "wire_national">,
  publish: (nation: string | null, headline: string, body: string) => Promise<void>,
  minSeverity: EventSeverity = "minor"
): BroadcastSink {
  return {
    channel,
    minSeverity,
    async deliver(message) {
      await publish(message.target.nation ?? null, message.headline, message.body);
    },
  };
}

/**
 * Discord sink. Routed through masscomm (comm_send) at integration time, behind
 * the same guardrails the bus already enforces (dedupe, rate limit) plus a high
 * severity floor here so only major+ beats ever reach the community. Ships as a
 * factory taking the send function so nothing here reaches the network on import.
 */
export function makeDiscordSink(
  channel: Extract<BroadcastChannel, "discord_global" | "discord_national">,
  send: (nation: string | null, headline: string, body: string) => Promise<void>,
  minSeverity: EventSeverity = "major"
): BroadcastSink {
  return {
    channel,
    minSeverity,
    async deliver(message) {
      await send(message.target.nation ?? null, message.headline, message.body);
    },
  };
}
