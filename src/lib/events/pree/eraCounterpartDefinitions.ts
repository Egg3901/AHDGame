import type { EventDefinition } from "@/lib/db/types/events";

/**
 * Era-gated period-counterpart PREE seed definitions.
 *
 * These keep the politics genre populated in early-era presets where the
 * modern media events (pree.campaignViral, pree.corruptDonor, ...) are
 * year-gated out. Each is a period-appropriate counterpart: radio for viral,
 * TV debut for the social clip, print feuds for online pile-ons, and the
 * ward boss for the corrupt donor.
 *
 * Option ids, labels, descriptions, and `defaultOptionId` MUST stay in
 * lockstep with the matching code handler in
 * `handlers/eraCounterpartEvents.ts`. The approve route rejects any drift.
 *
 * Outcome tables live in the handlers, not here; this file supplies the
 * player-facing copy and scope only.
 */
type EraDef = Omit<EventDefinition, "_id" | "createdAt" | "updatedAt">;

const draft = <T extends Partial<EraDef>>(d: T) =>
  ({
    status: "draft",
    version: 1,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    ...d,
  }) as EraDef;

export const ERA_COUNTERPART_DEFINITIONS: EraDef[] = [
  // era: broadcast radio's mass-audience political era — from the first
  // commercial stations (~1920) until television displaced it (~1965).
  // Period counterpart of pree.campaignViral.
  draft({
    kind: "pree.radioAddressSensation",
    minYear: 1920,
    maxYear: 1965,
    image:
      "https://images.unsplash.com/photo-1478737270239-2f02b77fc618?auto=format&fit=crop&w=1200&q=70",
    title: "Radio Address Sensation",
    headline: "A clip of your radio address is being replayed everywhere.",
    body: "Stations keep re-airing the moment, and nobody can tell yet if it helps.",
    eligibility: ["inElection"],
    baseWeight: 25,
    defaultOptionId: "nothing",
    options: [
      {
        id: "leanIn",
        label: "Lean in and book more airtime",
        description: "Keep talking while it's hot.",
      },
      { id: "disciplined", label: "Stay disciplined", description: "Stick to the message." },
      {
        id: "equalTime",
        label: "Demand equal time and a correction",
        description: "Press the stations for fairness.",
      },
      { id: "nothing", label: "Do nothing", description: "Let it play out.", isDefault: true },
    ],
  }),
  // era: television's arrival as the decisive campaign medium — from its
  // postwar rollout (~1950) through the era when TV fluency became mandatory
  // (post-Kennedy/Nixon, ~1975 it is simply "politics", not an event).
  draft({
    kind: "pree.televisionDebut",
    minYear: 1950,
    maxYear: 1975,
    image:
      "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=1200&q=70",
    title: "Television Debut",
    headline: "Your first television appearance could make you a household name overnight.",
    body: "The studio lights are hot and unforgiving. Half the district will be watching, and so will the columnists.",
    eligibility: ["politician"],
    baseWeight: 20,
    defaultOptionId: "refuseTv",
    options: [
      {
        id: "embraceMedium",
        label: "Embrace the new medium",
        description: "Speak to the camera like it's a voter's living room.",
      },
      {
        id: "stickScript",
        label: "Stick to the prepared script",
        description: "Read your remarks and take no risks.",
      },
      {
        id: "refuseTv",
        label: "Refuse future TV appearances",
        description: "Declare television a fad and stick to radio and print.",
        isDefault: true,
      },
      {
        id: "downplay",
        label: "Downplay the whole thing",
        description: "Treat it as just another speech.",
      },
    ],
  }),
  // era: the age of the powerful syndicated print columnist, before
  // television and later online media displaced print feuds (~1985).
  draft({
    kind: "pree.newspaperFeud",
    maxYear: 1985,
    image:
      "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=70",
    title: "Newspaper Feud",
    headline: "A powerful columnist has opened a feud with you in print.",
    body: "His column runs in every paper that matters, and this week's is about you. It is not flattering.",
    eligibility: ["politician"],
    baseWeight: 25,
    defaultOptionId: "ignoreDignified",
    options: [
      {
        id: "respondInKind",
        label: "Respond in kind",
        description: "Answer him column for column, barb for barb.",
      },
      {
        id: "ignoreDignified",
        label: "Ignore it with dignity",
        description: "Never wrestle with a man who buys ink by the barrel.",
        isDefault: true,
      },
      {
        id: "sueLibel",
        label: "Sue for libel",
        description: "Retain counsel and take him to court.",
      },
      {
        id: "inviteDinner",
        label: "Invite the columnist to dinner",
        description: "Try to charm him off the warpath.",
      },
    ],
  }),
  // era: the party-machine era of ward bosses and walking-around money,
  // before post-Watergate campaign-finance reform (~1975). Period
  // counterpart of pree.corruptDonor.
  draft({
    kind: "pree.partyMachineDonor",
    maxYear: 1975,
    image:
      "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=70",
    title: "The Ward Boss Calls",
    headline: "A party ward boss offers you 'walking-around money' for the campaign.",
    body: "Cash for election-day expenses, no questions asked, and no records kept. The machine expects gratitude, and remembers slights.",
    eligibility: ["inElection"],
    baseWeight: 20,
    defaultOptionId: "sayNothing",
    options: [
      {
        id: "accept",
        label: "Accept the envelope",
        description: "Take the cash and owe the machine.",
      },
      {
        id: "refuse",
        label: "Refuse politely",
        description: "Thank him and decline the money.",
      },
      {
        id: "report",
        label: "Report it to the authorities",
        description: "Turn the ward boss in.",
      },
      {
        id: "sayNothing",
        label: "Say nothing and move on",
        description: "Neither accept nor refuse; just change the subject.",
        isDefault: true,
      },
    ],
  }),
];
