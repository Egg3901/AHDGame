export const notificationsContent = `# Notification Center

Everything the game needs to tell you, elections, votes, wires, coalition activity, corporate events, moves against your character, lands in one inbox rather than a scatter of banners. This page is about reading and managing it, not about any one event type.

## Where it lives

The inbox sits at \`/notifications\`. It reads like a mail client: a list of items on one side, the open item on the other.

Items come in two shapes:

- **Notifications.** System-generated events: your bill passed committee, you were named Commanding General, your corporation's credit rating changed, an opponent attacked your character.
- **Mail.** Direct messages from other players and NPPs.

## Segments

The inbox splits into views rather than one long undifferentiated feed:

- **All.** Everything, mail and notifications together.
- **Notifs.** System-generated events only.
- **Mail.** Player-to-player and NPP messages only.
- **Action needed.** A filtered view surfacing items that are still waiting on something from you, so it does not get buried under read-and-done items like "your bill passed."

Within a view, unread items are tracked per item, and you can mark items read as you go rather than only in bulk.

## What generates a notification

Notifications come from every major system in the game, not just one. A non-exhaustive sample of what triggers one: election results (won or lost, primary or general), leadership and committee elections and appointments, bill status changes through committee and floor votes and signing, being named to a military Command, incoming wires, coalition invites and votes, corporate events (a CEO vote offer, a hostile-takeover opportunity, a bond coming due, nationalization risk), crisis alerts, and direct attacks or support from another player's character. If a system changes something that affects you, it is a candidate for a notification rather than something you'd only discover by checking that system's own page.

## Archiving

Any item can be archived out of your active list without deleting it. Archived items simply stop showing up in the segment views; nothing here permanently loses your history, it is a matter of keeping the working inbox from filling up with events you have already dealt with.

## Muting and snoozing by type

You are not stuck seeing every category forever. Per notification type (not per individual item), you can:

- **Mute** a type entirely. Muted types stop generating anything you see in the inbox until you unmute them.
- **Snooze** a type for a fixed 12-hour window. This is the right tool for "I don't want to see this right now but I do care about it long-term", the type comes back automatically once the window expires, no need to remember to turn it back on.

These preferences are per-account and apply going forward; they do not retroactively hide anything already in your inbox.

## What this means for you

- If a whole category of event is noise for how you play (say, every routine bill status change), muting that type keeps your inbox meaningful without losing anything else.
- Use "Action needed" as your default working view during a busy turn rather than scrolling all of "All".
- A snooze is temporary by design. If you actually want a type gone long-term, mute it instead of re-snoozing it every twelve hours.

See also: [Reading the Game](/wiki/reading-the-game), [Coalitions](/wiki/coalitions), [Mail](/wiki/mail).
`;
