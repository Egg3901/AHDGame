import { InboxClient } from "./inbox/InboxClient";

export default function NotificationsPage() {
  // Message bodies are excluded from PostHog session replay.
  return (
    <div data-replay-block>
      <InboxClient />
    </div>
  );
}
