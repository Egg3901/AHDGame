import type { CountryId } from "@/lib/constants/countries";

/** Static, authored history for the marketing globe. This never touches live crisis data. */
export type HistoricalCrisisShowcaseEntry = {
  id: string;
  year: number;
  lonLat: [number, number];
  countryId?: CountryId;
  title: string;
  description: string;
  /** `cdnStatic("landing", <slug>)` asset for the card's top image. Falls back
   *  to the shared "newsroom" still (see FlavorCardCarousel) when omitted. */
  imageSlug?: string;
};

export const HISTORICAL_CRISIS_SHOWCASE: readonly HistoricalCrisisShowcaseEntry[] = [
  {
    id: "berlin-uprising-1953",
    year: 1953,
    lonLat: [13.4, 52.52],
    countryId: "DD",
    title: "East German Uprising",
    description:
      "On 17 June, strikes over higher work quotas spread into a nationwide revolt against East Germany's government. Soviet troops and tanks suppressed the protests.",
    imageSlug: "world-1979",
  },
  {
    id: "korean-armistice-1953",
    year: 1953,
    lonLat: [126.68, 37.96],
    title: "Korean Armistice",
    description:
      "The armistice signed at Panmunjom on 27 July halted three years of fighting. It created a military ceasefire, not a peace treaty, and left Korea divided.",
  },
  {
    id: "hungarian-revolution-1956",
    year: 1956,
    lonLat: [19.04, 47.5],
    countryId: "HU",
    title: "Hungarian Revolution",
    description:
      "A student demonstration in Budapest on 23 October grew into a national revolt against Communist rule and Soviet control. Soviet forces invaded on 4 November and crushed it.",
  },
  {
    id: "suez-crisis-1956",
    year: 1956,
    lonLat: [32.3, 30.6],
    title: "Suez Crisis",
    description:
      "After Egypt nationalized the Suez Canal, Israel invaded Sinai on 29 October and Britain and France intervened. International pressure forced a ceasefire and withdrawal.",
  },
  {
    id: "berlin-wall-1961",
    year: 1961,
    lonLat: [13.4, 52.52],
    countryId: "DD",
    title: "Berlin Wall Built",
    description:
      "East German forces sealed the border around West Berlin on 13 August, first with troops and barbed wire. The barrier divided the city for more than 28 years.",
    imageSlug: "world-1979",
  },
  {
    id: "cuban-missile-crisis-1962",
    year: 1962,
    lonLat: [-80.0, 22.5],
    title: "Cuban Missile Crisis",
    description:
      "The discovery of Soviet nuclear missile sites in Cuba brought Washington and Moscow into their most dangerous Cold War confrontation. The missiles were withdrawn after thirteen tense days.",
  },
  {
    id: "prague-spring-1968",
    year: 1968,
    lonLat: [14.42, 50.08],
    title: "Prague Spring",
    description:
      "Czechoslovakia's reform movement sought a more open form of socialism. A Soviet-led Warsaw Pact invasion on 20–21 August ended the experiment.",
  },
  {
    id: "yom-kippur-war-1973",
    year: 1973,
    lonLat: [32.9, 30.0],
    title: "Yom Kippur War & Oil Shock",
    description:
      "Egypt and Syria attacked Israel on 6 October, triggering a superpower resupply contest. An Arab oil embargo announced on 17 October helped turn the war into a global energy crisis.",
  },
  {
    id: "iran-hostage-crisis-1979",
    year: 1979,
    lonLat: [51.39, 35.69],
    title: "Iran Hostage Crisis",
    description:
      "Militant students seized the U.S. Embassy in Tehran on 4 November and held American diplomats and citizens hostage. The ordeal lasted 444 days.",
  },
  {
    id: "soviet-invasion-afghanistan-1979",
    year: 1979,
    lonLat: [69.17, 34.53],
    title: "Soviet Invasion of Afghanistan",
    description:
      "Soviet forces entered Afghanistan in late December and took control of Kabul. The intervention opened a destructive war that lasted through the 1980s.",
  },
  {
    id: "able-archer-1983",
    year: 1983,
    lonLat: [7.0, 50.5],
    title: "Able Archer 83",
    description:
      "From 7–11 November, NATO rehearsed wartime command procedures, including nuclear release. Soviet fears surrounding the exercise made it an enduring symbol of Cold War miscalculation.",
  },
  {
    id: "chernobyl-1986",
    year: 1986,
    lonLat: [30.1, 51.39],
    title: "Chernobyl Disaster",
    description:
      "Reactor No. 4 exploded during a test on 26 April, releasing radioactive material across large parts of Europe. The disaster exposed grave failures in the Soviet nuclear system.",
  },
  {
    id: "berlin-wall-falls-1989",
    year: 1989,
    lonLat: [13.4, 52.52],
    countryId: "DD",
    title: "Fall of the Berlin Wall",
    description:
      "On 9 November, a confused announcement of new travel rules drew crowds to Berlin's border crossings. Overwhelmed guards opened the barriers that night.",
    imageSlug: "world-1979",
  },
  {
    id: "soviet-dissolution-1991",
    year: 1991,
    lonLat: [37.62, 55.75],
    countryId: "RU",
    title: "Dissolution of the Soviet Union",
    description:
      "Mikhail Gorbachev resigned on 25 December and the Soviet flag came down over the Kremlin. The union formally ceased to exist the following day.",
  },
];
