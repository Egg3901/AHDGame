/**
 * The 1991 broadcast lander's content: the year's headlines for the crawl,
 * each tied to the place it was filed from. The globe's satellites beam down
 * to those same datelines, so the crawl and the globe tell one story.
 */
import type { BroadcastTickerItem } from "./eraThemes";

const PLACES = {
  baghdad: { name: "Baghdad", lonLat: [44.37, 33.31] },
  kuwaitCity: { name: "Kuwait City", lonLat: [47.98, 29.37] },
  capeTown: { name: "Cape Town", lonLat: [18.42, -33.92] },
  ljubljana: { name: "Ljubljana", lonLat: [14.51, 46.06] },
  prague: { name: "Prague", lonLat: [14.42, 50.08] },
  newDelhi: { name: "New Delhi", lonLat: [77.21, 28.61] },
  moscow: { name: "Moscow", lonLat: [37.62, 55.75] },
  riga: { name: "Riga", lonLat: [24.11, 56.95] },
  maastricht: { name: "Maastricht", lonLat: [5.69, 50.85] },
  almaAta: { name: "Alma-Ata", lonLat: [76.95, 43.24] },
} as const;

/** Oldest first. The last item has no dateline: it is filed from orbit. */
export const TICKER_1991: readonly BroadcastTickerItem[] = [
  {
    date: "17 Jan",
    text: "Coalition air campaign against Iraq begins",
    place: PLACES.baghdad,
  },
  {
    date: "28 Feb",
    text: "Gulf War ceasefire after 100 hours of ground combat",
    place: PLACES.kuwaitCity,
  },
  {
    date: "17 Jun",
    text: "South Africa repeals the Population Registration Act",
    place: PLACES.capeTown,
  },
  {
    date: "25 Jun",
    text: "Slovenia and Croatia declare independence from Yugoslavia",
    place: PLACES.ljubljana,
  },
  { date: "1 Jul", text: "Warsaw Pact formally dissolved in Prague", place: PLACES.prague },
  { date: "24 Jul", text: "India abolishes most industrial licensing", place: PLACES.newDelhi },
  {
    date: "31 Jul",
    text: "Bush and Gorbachev sign the START treaty in Moscow",
    place: PLACES.moscow,
  },
  {
    date: "21 Aug",
    text: "Hardliners' coup in Moscow collapses after three days",
    place: PLACES.moscow,
  },
  {
    date: "6 Sep",
    text: "USSR recognizes Estonian, Latvian and Lithuanian independence",
    place: PLACES.riga,
  },
  {
    date: "10 Dec",
    text: "Maastricht summit agrees the Treaty on European Union",
    place: PLACES.maastricht,
  },
  {
    date: "21 Dec",
    text: "Eleven republics join the Commonwealth of Independent States",
    place: PLACES.almaAta,
  },
  {
    date: "25 Dec",
    text: "Gorbachev resigns. The Soviet flag is lowered over the Kremlin",
    place: PLACES.moscow,
  },
  { date: "26 Dec", text: "The Soviet Union formally ceases to exist", place: PLACES.moscow },
  {
    date: "In orbit",
    text: "Cosmonaut Sergei Krikalev, launched from the USSR in May, is still aboard Mir",
  },
];
