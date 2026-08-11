/**
 * Era-specific flavor cards for the homepage carousel.
 * Each era gets 3 static "leader" cards + dynamic event cards follow.
 *
 * Portrait licensing (public landing page — every image slug used here MUST
 * have a documented free license before the asset is uploaded to the CDN):
 *
 * | slug   | source                                                        | license       |
 * |--------|---------------------------------------------------------------|---------------|
 * | bush   | Commons "George H. W. Bush presidential portrait.jpg",        | Public domain |
 * |        | David Valdez / White House                                    |               |
 * | deng   | Commons "Deng Xiaoping.jpg"                                   | Public domain |
 * | major  | Commons "John Major 1996.jpg", PFC Tracey L. Hall-Leahy, USA  | Public domain |
 *
 * All other imageSlug values below (eisenhower, churchill, malenkov, carter,
 * callaghan, clinton, blair, jiang, bush-jr, brown, hu, trump, may, xi,
 * biden, sunak) have NO asset on the CDN — the card renders without an image
 * (StaticCard hides the <img> onError). Do not upload portraits for them
 * without recording a public-domain/CC source in this table first.
 */

export type FlavorCard = {
  id: string;
  name: string;
  title: string;
  country: string;
  countryCode: string;
  quote: string;
  imageSlug: string;
  year: string;
};

export type EraFlavorCards = {
  era: string;
  cards: FlavorCard[];
};

export const ERA_FLAVOR_CARDS: Record<string, FlavorCard[]> = {
  "1953": [
    {
      id: "eisenhower",
      name: "Dwight D. Eisenhower",
      title: "President of the United States",
      country: "United States",
      countryCode: "US",
      quote:
        "The middle of the road is all of the usable surface. The extremes, right and left, are in the gutters.",
      imageSlug: "eisenhower",
      year: "1953",
    },
    {
      id: "churchill",
      name: "Winston Churchill",
      title: "Prime Minister of the United Kingdom",
      country: "United Kingdom",
      countryCode: "UK",
      quote: "To jaw-jaw is always better than to war-war.",
      imageSlug: "churchill",
      year: "1953",
    },
    {
      id: "malenkov",
      name: "Georgy Malenkov",
      title: "Chairman of the Council of Ministers of the USSR",
      country: "Soviet Union",
      countryCode: "RU",
      quote: "Nuclear war would mean the destruction of world civilization.",
      imageSlug: "malenkov",
      year: "1953",
    },
  ],
  "1979": [
    {
      id: "carter",
      name: "Jimmy Carter",
      title: "President of the United States",
      country: "United States",
      countryCode: "US",
      quote:
        "We become not a melting pot but a beautiful mosaic. Different people, different beliefs, different yearnings, different hopes, different dreams.",
      imageSlug: "carter",
      year: "1979",
    },
    {
      id: "callaghan",
      name: "James Callaghan",
      title: "Prime Minister of the United Kingdom",
      country: "United Kingdom",
      countryCode: "UK",
      quote: "A lie can be halfway round the world before the truth has got its boots on.",
      imageSlug: "callaghan",
      year: "1979",
    },
    {
      id: "deng-1979",
      name: "Deng Xiaoping",
      title: "Paramount Leader of China",
      country: "China",
      countryCode: "CN",
      quote: "It doesn't matter whether a cat is black or white, as long as it catches mice.",
      imageSlug: "deng",
      year: "1979",
    },
  ],
  "1991": [
    {
      id: "bush",
      name: "George H.W. Bush",
      title: "President of the United States",
      country: "United States",
      countryCode: "US",
      quote:
        "Read my lips: no new taxes. But this is a time of transformation, and the world is changing faster than our politics can keep up.",
      imageSlug: "bush",
      year: "1991",
    },
    {
      id: "major",
      name: "John Major",
      title: "Prime Minister of the United Kingdom",
      country: "United Kingdom",
      countryCode: "UK",
      quote:
        "A nation at ease with itself. A country that is confident and prepared to meet the challenges of the future.",
      imageSlug: "major",
      year: "1991",
    },
    {
      id: "deng-1991",
      name: "Deng Xiaoping",
      title: "Paramount Leader of China",
      country: "China",
      countryCode: "CN",
      quote: "Development is the absolute principle. Keep a cool head and maintain a low profile.",
      imageSlug: "deng",
      year: "1991",
    },
  ],
  "1999": [
    {
      id: "clinton",
      name: "Bill Clinton",
      title: "President of the United States",
      country: "United States",
      countryCode: "US",
      quote:
        "The era of big government is over. But we cannot go back to the time when our citizens were left to fend for themselves.",
      imageSlug: "clinton",
      year: "1999",
    },
    {
      id: "blair",
      name: "Tony Blair",
      title: "Prime Minister of the United Kingdom",
      country: "United Kingdom",
      countryCode: "UK",
      quote: "Education, education, education. The key to the future of a modern Britain.",
      imageSlug: "blair",
      year: "1999",
    },
    {
      id: "jiang",
      name: "Jiang Zemin",
      title: "General Secretary of the Communist Party",
      country: "China",
      countryCode: "CN",
      quote:
        "The important thing is to seize the opportunity to develop the economy. We must not miss the boat.",
      imageSlug: "jiang",
      year: "1999",
    },
  ],
  "2007": [
    {
      id: "bush-2007",
      name: "George W. Bush",
      title: "President of the United States",
      country: "United States",
      countryCode: "US",
      quote:
        "We're fighting them over there so we don't have to fight them here. The surge is working.",
      imageSlug: "bush-jr",
      year: "2007",
    },
    {
      id: "brown",
      name: "Gordon Brown",
      title: "Prime Minister of the United Kingdom",
      country: "United Kingdom",
      countryCode: "UK",
      quote:
        "This is no time for a novice. We have shown that we can steer Britain through the storm.",
      imageSlug: "brown",
      year: "2007",
    },
    {
      id: "hu",
      name: "Hu Jintao",
      title: "General Secretary of the Communist Party",
      country: "China",
      countryCode: "CN",
      quote:
        "A harmonious society is the foundation of sustainable development. We must build socialism with Chinese characteristics.",
      imageSlug: "hu",
      year: "2007",
    },
  ],
  "2019": [
    {
      id: "trump",
      name: "Donald Trump",
      title: "President of the United States",
      country: "United States",
      countryCode: "US",
      quote:
        "America First. We will make America great again, and we are winning like never before.",
      imageSlug: "trump",
      year: "2019",
    },
    {
      id: "may",
      name: "Theresa May",
      title: "Prime Minister of the United Kingdom",
      country: "United Kingdom",
      countryCode: "UK",
      quote:
        "Brexit means Brexit, and we are going to make a success of it. No deal is better than a bad deal.",
      imageSlug: "may",
      year: "2019",
    },
    {
      id: "xi-2019",
      name: "Xi Jinping",
      title: "General Secretary of the Communist Party",
      country: "China",
      countryCode: "CN",
      quote: "The great rejuvenation of the Chinese nation is within reach. No force can stop us.",
      imageSlug: "xi",
      year: "2019",
    },
  ],
  "2023": [
    {
      id: "biden",
      name: "Joe Biden",
      title: "President of the United States",
      country: "United States",
      countryCode: "US",
      quote:
        "We are the United States of America, and there is nothing beyond our capacity. Democracy is not a spectator sport.",
      imageSlug: "biden",
      year: "2023",
    },
    {
      id: "sunak",
      name: "Rishi Sunak",
      title: "Prime Minister of the United Kingdom",
      country: "United Kingdom",
      countryCode: "UK",
      quote:
        "We will create a future that is built on innovation, powered by technology, and driven by the British people.",
      imageSlug: "sunak",
      year: "2023",
    },
    {
      id: "xi-2023",
      name: "Xi Jinping",
      title: "General Secretary of the Communist Party",
      country: "China",
      countryCode: "CN",
      quote:
        "Chinese modernization is the path to building a great modern socialist country. We will unwaveringly follow this path.",
      imageSlug: "xi",
      year: "2023",
    },
  ],
};

/** Get flavor cards for an era, falling back to 1979. */
export function getEraFlavorCards(year: number | string): FlavorCard[] {
  const key = String(year);
  return ERA_FLAVOR_CARDS[key] ?? ERA_FLAVOR_CARDS["1979"];
}
