/**
 * The 1991 broadcast lander's content: the year's headlines, each tied to the
 * place it was filed from. The globe's satellites beam down to those datelines
 * and name them.
 */
import type { BroadcastTickerItem } from "./eraThemes";
import type { HistoricalCrisisShowcaseEntry } from "./historicalCrisisShowcase";

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

/** A place's coordinates as the mutable pair the globe's d3 calls take. */
const at = (place: { lonLat: readonly [number, number] }): [number, number] => [
  place.lonLat[0],
  place.lonLat[1],
];

/**
 * The globe's idle tour for a 1991 world: the year's events at their
 * datelines, in date order, instead of the Cold War tour that opens on 1953.
 */
export const SHOWCASE_1991: readonly HistoricalCrisisShowcaseEntry[] = [
  {
    id: "desert-storm-1991",
    year: 1991,
    lonLat: at(PLACES.baghdad),
    title: "Desert Storm",
    description:
      "A US-led coalition began bombing Iraq on 17 January to force its army out of Kuwait. The ground war that followed in February lasted 100 hours.",
  },
  {
    id: "population-registration-repeal-1991",
    year: 1991,
    lonLat: at(PLACES.capeTown),
    title: "Population Registration Act repealed",
    description:
      "On 17 June, South Africa's parliament repealed the law that had classified every citizen by race since 1950.",
  },
  {
    id: "slovenia-croatia-1991",
    year: 1991,
    lonLat: at(PLACES.ljubljana),
    title: "Slovenia and Croatia declare independence",
    description:
      "Both republics left Yugoslavia on 25 June. Slovenia's war lasted ten days. In Croatia the fighting went on for the rest of the year.",
  },
  {
    id: "warsaw-pact-1991",
    year: 1991,
    lonLat: at(PLACES.prague),
    title: "The Warsaw Pact dissolves",
    description:
      "Its remaining members signed the alliance's dissolution in Prague on 1 July, 36 years after it was founded.",
  },
  {
    id: "india-reforms-1991",
    year: 1991,
    lonLat: at(PLACES.newDelhi),
    title: "India's economic reforms",
    description:
      "With its foreign reserves nearly exhausted, India devalued the rupee in July and abolished most industrial licensing on 24 July.",
    imageSlug: "global-markets",
  },
  {
    id: "august-coup-1991",
    year: 1991,
    lonLat: at(PLACES.moscow),
    countryId: "RU",
    title: "The August coup",
    description:
      "Hardliners detained Gorbachev in Crimea on 19 August and declared a state of emergency. Crowds defended the Russian parliament and the coup collapsed in three days.",
  },
  {
    id: "baltic-independence-1991",
    year: 1991,
    lonLat: at(PLACES.riga),
    title: "Baltic independence recognized",
    description:
      "On 6 September the Soviet State Council recognized the independence of Estonia, Latvia and Lithuania, annexed by the Soviet Union in 1940.",
  },
  {
    id: "maastricht-1991",
    year: 1991,
    lonLat: at(PLACES.maastricht),
    title: "Maastricht treaty agreed",
    description:
      "The twelve European Community governments agreed the Treaty on European Union on 10 December, with a timetable for a single currency by 1999.",
    imageSlug: "central-banks",
  },
  {
    id: "alma-ata-1991",
    year: 1991,
    lonLat: at(PLACES.almaAta),
    title: "The Commonwealth of Independent States",
    description:
      "On 21 December eleven former Soviet republics signed the Alma-Ata Protocol, joining the commonwealth that Russia, Ukraine and Belarus founded on 8 December.",
  },
  {
    id: "soviet-flag-lowered-1991",
    year: 1991,
    lonLat: at(PLACES.moscow),
    countryId: "RU",
    title: "The Soviet flag is lowered",
    description:
      "Gorbachev resigned on 25 December. That evening the Soviet flag came down over the Kremlin and the Russian tricolor went up in its place. The Soviet Union formally ceased to exist the next day.",
  },
];
