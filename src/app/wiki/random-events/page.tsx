import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getDb } from "@/lib/mongodb";

export const metadata: Metadata = {
  title: "Random Events | Wiki | A House Divided",
  description:
    "Every random event in A House Divided — browse hero images, eligibility, and how each event plays out.",
};

interface EventDef {
  _id: string;
  kind: string;
  title: string;
  body: string;
  image?: string;
  eligibility: string[];
}

const ELIGIBILITY_STYLES: Record<string, string> = {
  all: "bg-primary/15 text-primary",
  politician: "bg-blue-500/15 text-blue-400",
  ceo: "bg-amber-500/15 text-amber-400",
  inElection: "bg-green-500/15 text-green-400",
};

async function getApprovedEvents(): Promise<EventDef[]> {
  const db = await getDb();
  const docs = await db
    .collection("eventDefinitions")
    .find({ status: "approved" })
    .sort({ title: 1 })
    .project({ kind: 1, title: 1, body: 1, image: 1, eligibility: 1 })
    .toArray();
  return docs.map((d) => ({
    _id: d._id.toString(),
    kind: d.kind as string,
    title: d.title as string,
    body: d.body as string,
    image: d.image as string | undefined,
    eligibility: (d.eligibility as string[]) ?? [],
  }));
}

export default async function RandomEventsWikiPage() {
  const events = await getApprovedEvents();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/wiki" className="hover:text-primary">
          Wiki
        </Link>
        <span>/</span>
        <span className="text-foreground">Random Events</span>
      </nav>

      <header className="mb-8 border-b border-card-border pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Random Events</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Each turn, eligible characters may receive a random event from the PREE (Player Random
          Event Engine). Events are weighted by eligibility — some require holding office, running a
          corporation, or being mid-campaign. Players choose from up to three options; the outcome
          is determined by a hidden dice roll.
        </p>
      </header>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border bg-card/40 p-12 text-center">
          <p className="font-medium text-muted">No approved events found.</p>
          <p className="mt-1 text-sm text-muted">
            Run <strong>Reseed &amp; Approve All</strong> from Admin → World → Random Events to
            populate this page.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm text-muted">{events.length} events</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((ev) => (
              <EventCard key={ev._id} event={ev} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EventCard({ event }: { event: EventDef }) {
  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card/60">
      <div className="relative h-40 w-full bg-card">
        {event.image ? (
          <Image src={event.image} alt={event.title} fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card to-card/40">
            <span className="font-mono text-xs text-muted">{event.kind}</span>
          </div>
        )}
      </div>

      <div className="p-4">
        <p className="font-semibold text-foreground">{event.title}</p>

        <div className="mt-2 flex flex-wrap gap-1">
          {event.eligibility.map((e) => (
            <span
              key={e}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ELIGIBILITY_STYLES[e] ?? "bg-muted/15 text-muted"}`}
            >
              {e}
            </span>
          ))}
        </div>

        <p className="mt-2 line-clamp-3 text-sm text-muted">{event.body}</p>
      </div>
    </div>
  );
}
