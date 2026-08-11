// src/lib/inbox/mailThreads.ts
export type SerializedMail = {
  _id: string;
  fromCharacterId?: string;
  fromCharacterName: string;
  toCharacterId: string;
  toCharacterName: string;
  subject: string;
  body: string;
  read: boolean;
  createdAt: string;
};
export type MailMessage = { from: "you" | "them"; time: string; body: string; id?: string };
export type MailThread = {
  id: string;
  counterpartId?: string;
  counterpartName: string;
  subject: string;
  unread: boolean;
  messages: MailMessage[];
  latestAt: string;
};

export const normalizeMailSubject = (s: string) =>
  s
    .replace(/^(\s*re:\s*)+/i, "")
    .trim()
    .toLowerCase();

const normalizeSubject = normalizeMailSubject;

export function groupMailIntoThreads(
  inbox: SerializedMail[],
  sent: SerializedMail[],
  _selfCharacterId: string
): MailThread[] {
  const byKey = new Map<
    string,
    { mails: (SerializedMail & { mine: boolean })[]; name: string; cpId?: string }
  >();
  const add = (m: SerializedMail, mine: boolean) => {
    const counterpartId = mine ? m.toCharacterId : m.fromCharacterId;
    const counterpartName = mine ? m.toCharacterName : m.fromCharacterName;
    const key = `${counterpartId ?? counterpartName}::${normalizeSubject(m.subject)}`;
    const bucket = byKey.get(key) ?? { mails: [], name: counterpartName, cpId: counterpartId };
    bucket.mails.push({ ...m, mine });
    byKey.set(key, bucket);
  };
  inbox.forEach((m) => add(m, false));
  sent.forEach((m) => add(m, true));

  const threads: MailThread[] = [];
  for (const [key, b] of byKey) {
    const sorted = b.mails.sort((a, c) => a.createdAt.localeCompare(c.createdAt));
    const display = sorted.find((m) => !m.mine)?.subject ?? sorted[0].subject;
    threads.push({
      id: key,
      counterpartId: b.cpId,
      counterpartName: b.name,
      subject: display.replace(/^(\s*re:\s*)+/i, "").trim(),
      unread: sorted.some((m) => !m.mine && !m.read),
      messages: sorted.map((m) => ({
        from: m.mine ? "you" : "them",
        time: m.createdAt,
        body: m.body,
        ...(m.mine ? {} : { id: m._id }),
      })),
      latestAt: sorted[sorted.length - 1].createdAt,
    });
  }
  return threads.sort((a, c) => c.latestAt.localeCompare(a.latestAt));
}
