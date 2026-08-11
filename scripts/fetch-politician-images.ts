/**
 * Fetch politician portrait images from Wikipedia's REST API.
 * Writes to src/data/npp-politician-images.json for use by NPP generation.
 *
 * Run: npx tsx scripts/fetch-politician-images.ts
 *
 * Rate-limited to 1 request per 200ms (Wikipedia asks for polite crawling).
 * Skip entries that already have a URL to allow incremental updates.
 */

import fs from "fs";
import path from "path";

interface PoliticianSeed {
  id: string;
  name: string;
  country: "US" | "UK";
  gender: "male" | "female";
  ethnicity: "white" | "black" | "hispanic" | "asian" | "other";
  wikiSlug: string;
}

export interface PoliticianImage {
  id: string;
  name: string;
  country: "US" | "UK";
  gender: "male" | "female";
  ethnicity: "white" | "black" | "hispanic" | "asian" | "other";
  url: string;
}

// ─── Politician seed list ─────────────────────────────────────────────────────

const POLITICIANS: PoliticianSeed[] = [
  // ── US — White Male ───────────────────────────────────────────────────────
  {
    id: "joe-biden",
    name: "Joe Biden",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Joe_Biden",
  },
  {
    id: "donald-trump",
    name: "Donald Trump",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Donald_Trump",
  },
  {
    id: "bernie-sanders",
    name: "Bernie Sanders",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Bernie_Sanders",
  },
  {
    id: "mitch-mcconnell",
    name: "Mitch McConnell",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Mitch_McConnell",
  },
  {
    id: "chuck-schumer",
    name: "Chuck Schumer",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Chuck_Schumer",
  },
  {
    id: "mike-johnson",
    name: "Mike Johnson",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Mike_Johnson_(Louisiana_politician)",
  },
  {
    id: "jim-jordan",
    name: "Jim Jordan",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Jim_Jordan_(politician)",
  },
  {
    id: "rand-paul",
    name: "Rand Paul",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Rand_Paul",
  },
  {
    id: "mitt-romney",
    name: "Mitt Romney",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Mitt_Romney",
  },
  {
    id: "gavin-newsom",
    name: "Gavin Newsom",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Gavin_Newsom",
  },
  {
    id: "ron-desantis",
    name: "Ron DeSantis",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Ron_DeSantis",
  },
  {
    id: "john-cornyn",
    name: "John Cornyn",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "John_Cornyn",
  },
  {
    id: "lindsey-graham",
    name: "Lindsey Graham",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Lindsey_Graham",
  },
  {
    id: "tom-cotton",
    name: "Tom Cotton",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Tom_Cotton",
  },
  {
    id: "mike-pence",
    name: "Mike Pence",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Mike_Pence",
  },
  {
    id: "pete-buttigieg",
    name: "Pete Buttigieg",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Pete_Buttigieg",
  },
  {
    id: "greg-abbott",
    name: "Greg Abbott",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Greg_Abbott",
  },
  {
    id: "larry-hogan",
    name: "Larry Hogan",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Larry_Hogan",
  },
  {
    id: "ron-wyden",
    name: "Ron Wyden",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Ron_Wyden",
  },
  {
    id: "jeff-merkley",
    name: "Jeff Merkley",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Jeff_Merkley",
  },
  {
    id: "joe-manchin",
    name: "Joe Manchin",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Joe_Manchin",
  },
  {
    id: "brian-kemp",
    name: "Brian Kemp",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Brian_Kemp",
  },
  {
    id: "glenn-youngkin",
    name: "Glenn Youngkin",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Glenn_Youngkin",
  },
  {
    id: "jb-pritzker",
    name: "J.B. Pritzker",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "J._B._Pritzker",
  },
  {
    id: "josh-shapiro",
    name: "Josh Shapiro",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Josh_Shapiro",
  },
  {
    id: "andy-beshear",
    name: "Andy Beshear",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Andy_Beshear",
  },
  {
    id: "tony-evers",
    name: "Tony Evers",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Tony_Evers",
  },
  {
    id: "chris-murphy",
    name: "Chris Murphy",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Chris_Murphy_(politician)",
  },
  {
    id: "mike-lee",
    name: "Mike Lee",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Mike_Lee_(American_politician)",
  },
  {
    id: "john-fetterman",
    name: "John Fetterman",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "John_Fetterman",
  },
  {
    id: "tim-walz",
    name: "Tim Walz",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Tim_Walz",
  },
  {
    id: "adam-schiff",
    name: "Adam Schiff",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Adam_Schiff",
  },
  {
    id: "jon-tester",
    name: "Jon Tester",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Jon_Tester",
  },
  {
    id: "bob-casey-jr",
    name: "Bob Casey Jr.",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Bob_Casey_Jr.",
  },
  {
    id: "kevin-mccarthy",
    name: "Kevin McCarthy",
    country: "US",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Kevin_McCarthy_(California_politician)",
  },

  // ── US — White Female ─────────────────────────────────────────────────────
  {
    id: "elizabeth-warren",
    name: "Elizabeth Warren",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Elizabeth_Warren",
  },
  {
    id: "nancy-pelosi",
    name: "Nancy Pelosi",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Nancy_Pelosi",
  },
  {
    id: "susan-collins",
    name: "Susan Collins",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Susan_Collins",
  },
  {
    id: "lisa-murkowski",
    name: "Lisa Murkowski",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Lisa_Murkowski",
  },
  {
    id: "amy-klobuchar",
    name: "Amy Klobuchar",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Amy_Klobuchar",
  },
  {
    id: "kyrsten-sinema",
    name: "Kyrsten Sinema",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Kyrsten_Sinema",
  },
  {
    id: "patty-murray",
    name: "Patty Murray",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Patty_Murray",
  },
  {
    id: "maria-cantwell",
    name: "Maria Cantwell",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Maria_Cantwell",
  },
  {
    id: "gretchen-whitmer",
    name: "Gretchen Whitmer",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Gretchen_Whitmer",
  },
  {
    id: "kathy-hochul",
    name: "Kathy Hochul",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Kathy_Hochul",
  },
  {
    id: "katie-porter",
    name: "Katie Porter",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Katie_Porter",
  },
  {
    id: "tammy-baldwin",
    name: "Tammy Baldwin",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Tammy_Baldwin",
  },
  {
    id: "debbie-stabenow",
    name: "Debbie Stabenow",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Debbie_Stabenow",
  },
  {
    id: "maura-healey",
    name: "Maura Healey",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Maura_Healey",
  },
  {
    id: "liz-cheney",
    name: "Liz Cheney",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Liz_Cheney",
  },
  {
    id: "elise-stefanik",
    name: "Elise Stefanik",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Elise_Stefanik",
  },
  {
    id: "hillary-clinton",
    name: "Hillary Clinton",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Hillary_Clinton",
  },
  {
    id: "sarah-huckabee-sanders",
    name: "Sarah Huckabee Sanders",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Sarah_Huckabee_Sanders",
  },
  {
    id: "kristi-noem",
    name: "Kristi Noem",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Kristi_Noem",
  },
  {
    id: "maggie-hassan",
    name: "Maggie Hassan",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Maggie_Hassan",
  },
  {
    id: "jacky-rosen",
    name: "Jacky Rosen",
    country: "US",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Jacky_Rosen",
  },

  // ── US — Black Male ───────────────────────────────────────────────────────
  {
    id: "hakeem-jeffries",
    name: "Hakeem Jeffries",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Hakeem_Jeffries",
  },
  {
    id: "cory-booker",
    name: "Cory Booker",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Cory_Booker",
  },
  {
    id: "raphael-warnock",
    name: "Raphael Warnock",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Raphael_Warnock",
  },
  {
    id: "tim-scott",
    name: "Tim Scott",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Tim_Scott",
  },
  {
    id: "james-clyburn",
    name: "James Clyburn",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "James_Clyburn",
  },
  {
    id: "al-green-tx",
    name: "Al Green",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Al_Green_(politician)",
  },
  {
    id: "eric-adams",
    name: "Eric Adams",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Eric_Adams",
  },
  {
    id: "wes-moore",
    name: "Wes Moore",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Wes_Moore",
  },
  {
    id: "bobby-rush",
    name: "Bobby Rush",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Bobby_Rush",
  },
  {
    id: "cedric-richmond",
    name: "Cedric Richmond",
    country: "US",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Cedric_Richmond",
  },

  // ── US — Black Female ─────────────────────────────────────────────────────
  {
    id: "kamala-harris",
    name: "Kamala Harris",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Kamala_Harris",
  },
  {
    id: "barbara-lee",
    name: "Barbara Lee",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Barbara_Lee",
  },
  {
    id: "karen-bass",
    name: "Karen Bass",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Karen_Bass",
  },
  {
    id: "ayanna-pressley",
    name: "Ayanna Pressley",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Ayanna_Pressley",
  },
  {
    id: "val-demings",
    name: "Val Demings",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Val_Demings",
  },
  {
    id: "stacey-abrams",
    name: "Stacey Abrams",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Stacey_Abrams",
  },
  {
    id: "alma-adams",
    name: "Alma Adams",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Alma_Adams",
  },
  {
    id: "joyce-beatty",
    name: "Joyce Beatty",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Joyce_Beatty",
  },
  {
    id: "sheila-jackson-lee",
    name: "Sheila Jackson Lee",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Sheila_Jackson_Lee",
  },
  {
    id: "maxine-waters",
    name: "Maxine Waters",
    country: "US",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Maxine_Waters",
  },

  // ── US — Hispanic Male ────────────────────────────────────────────────────
  {
    id: "marco-rubio",
    name: "Marco Rubio",
    country: "US",
    gender: "male",
    ethnicity: "hispanic",
    wikiSlug: "Marco_Rubio",
  },
  {
    id: "ted-cruz",
    name: "Ted Cruz",
    country: "US",
    gender: "male",
    ethnicity: "hispanic",
    wikiSlug: "Ted_Cruz",
  },
  {
    id: "alex-padilla",
    name: "Alex Padilla",
    country: "US",
    gender: "male",
    ethnicity: "hispanic",
    wikiSlug: "Alex_Padilla",
  },
  {
    id: "joaquin-castro",
    name: "Joaquín Castro",
    country: "US",
    gender: "male",
    ethnicity: "hispanic",
    wikiSlug: "Joaquín_Castro",
  },
  {
    id: "raul-grijalva",
    name: "Raúl Grijalva",
    country: "US",
    gender: "male",
    ethnicity: "hispanic",
    wikiSlug: "Raúl_Grijalva",
  },
  {
    id: "ben-ray-lujan",
    name: "Ben Ray Luján",
    country: "US",
    gender: "male",
    ethnicity: "hispanic",
    wikiSlug: "Ben_Ray_Luján",
  },
  {
    id: "ruben-gallego",
    name: "Ruben Gallego",
    country: "US",
    gender: "male",
    ethnicity: "hispanic",
    wikiSlug: "Ruben_Gallego",
  },

  // ── US — Hispanic Female ──────────────────────────────────────────────────
  {
    id: "michelle-lujan-grisham",
    name: "Michelle Lujan Grisham",
    country: "US",
    gender: "female",
    ethnicity: "hispanic",
    wikiSlug: "Michelle_Lujan_Grisham",
  },
  {
    id: "nydia-velazquez",
    name: "Nydia Velázquez",
    country: "US",
    gender: "female",
    ethnicity: "hispanic",
    wikiSlug: "Nydia_Velázquez",
  },
  {
    id: "veronica-escobar",
    name: "Veronica Escobar",
    country: "US",
    gender: "female",
    ethnicity: "hispanic",
    wikiSlug: "Veronica_Escobar",
  },
  {
    id: "sylvia-garcia",
    name: "Sylvia Garcia",
    country: "US",
    gender: "female",
    ethnicity: "hispanic",
    wikiSlug: "Sylvia_Garcia",
  },
  {
    id: "linda-sanchez",
    name: "Linda Sánchez",
    country: "US",
    gender: "female",
    ethnicity: "hispanic",
    wikiSlug: "Linda_Sánchez",
  },
  {
    id: "teresa-leger-fernandez",
    name: "Teresa Leger Fernandez",
    country: "US",
    gender: "female",
    ethnicity: "hispanic",
    wikiSlug: "Teresa_Leger_Fernandez",
  },

  // ── US — Asian Male ───────────────────────────────────────────────────────
  {
    id: "ro-khanna",
    name: "Ro Khanna",
    country: "US",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Ro_Khanna",
  },
  {
    id: "andy-kim",
    name: "Andy Kim",
    country: "US",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Andy_Kim_(politician)",
  },
  {
    id: "mark-takano",
    name: "Mark Takano",
    country: "US",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Mark_Takano",
  },
  {
    id: "ted-lieu",
    name: "Ted Lieu",
    country: "US",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Ted_Lieu",
  },
  {
    id: "ami-bera",
    name: "Ami Bera",
    country: "US",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Ami_Bera",
  },

  // ── US — Asian Female ─────────────────────────────────────────────────────
  {
    id: "mazie-hirono",
    name: "Mazie Hirono",
    country: "US",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Mazie_Hirono",
  },
  {
    id: "grace-meng",
    name: "Grace Meng",
    country: "US",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Grace_Meng",
  },
  {
    id: "pramila-jayapal",
    name: "Pramila Jayapal",
    country: "US",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Pramila_Jayapal",
  },
  {
    id: "young-kim",
    name: "Young Kim",
    country: "US",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Young_Kim_(politician)",
  },
  {
    id: "tammy-duckworth",
    name: "Tammy Duckworth",
    country: "US",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Tammy_Duckworth",
  },
  {
    id: "nikki-haley",
    name: "Nikki Haley",
    country: "US",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Nikki_Haley",
  },

  // ── UK — White Male ───────────────────────────────────────────────────────
  {
    id: "keir-starmer",
    name: "Keir Starmer",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Keir_Starmer",
  },
  {
    id: "boris-johnson",
    name: "Boris Johnson",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Boris_Johnson",
  },
  {
    id: "david-cameron",
    name: "David Cameron",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "David_Cameron",
  },
  {
    id: "tony-blair",
    name: "Tony Blair",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Tony_Blair",
  },
  {
    id: "gordon-brown",
    name: "Gordon Brown",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Gordon_Brown",
  },
  {
    id: "john-major",
    name: "John Major",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "John_Major",
  },
  {
    id: "jeremy-corbyn",
    name: "Jeremy Corbyn",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Jeremy_Corbyn",
  },
  {
    id: "ed-miliband",
    name: "Ed Miliband",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Ed_Miliband",
  },
  {
    id: "nick-clegg",
    name: "Nick Clegg",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Nick_Clegg",
  },
  {
    id: "ed-davey",
    name: "Ed Davey",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Ed_Davey",
  },
  {
    id: "tim-farron",
    name: "Tim Farron",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Tim_Farron",
  },
  {
    id: "vince-cable",
    name: "Vince Cable",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Vince_Cable",
  },
  {
    id: "nigel-farage",
    name: "Nigel Farage",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Nigel_Farage",
  },
  {
    id: "michael-gove",
    name: "Michael Gove",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Michael_Gove",
  },
  {
    id: "jeremy-hunt",
    name: "Jeremy Hunt",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Jeremy_Hunt_(politician)",
  },
  {
    id: "dominic-raab",
    name: "Dominic Raab",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Dominic_Raab",
  },
  {
    id: "peter-mandelson",
    name: "Peter Mandelson",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Peter_Mandelson",
  },
  {
    id: "hilary-benn",
    name: "Hilary Benn",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Hilary_Benn",
  },
  {
    id: "john-mcdonnell",
    name: "John McDonnell",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "John_McDonnell_(politician)",
  },
  {
    id: "ian-blackford",
    name: "Ian Blackford",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Ian_Blackford",
  },
  {
    id: "john-swinney",
    name: "John Swinney",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "John_Swinney",
  },
  {
    id: "mark-drakeford",
    name: "Mark Drakeford",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Mark_Drakeford",
  },
  {
    id: "alex-salmond",
    name: "Alex Salmond",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Alex_Salmond",
  },
  {
    id: "jacob-rees-mogg",
    name: "Jacob Rees-Mogg",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Jacob_Rees-Mogg",
  },
  {
    id: "iain-duncan-smith",
    name: "Iain Duncan Smith",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Iain_Duncan_Smith",
  },
  {
    id: "william-hague",
    name: "William Hague",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "William_Hague",
  },
  {
    id: "michael-howard",
    name: "Michael Howard",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Michael_Howard",
  },
  {
    id: "george-osborne",
    name: "George Osborne",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "George_Osborne",
  },
  {
    id: "andy-burnham",
    name: "Andy Burnham",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Andy_Burnham",
  },
  {
    id: "tom-tugendhat",
    name: "Tom Tugendhat",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Tom_Tugendhat",
  },
  {
    id: "chris-bryant",
    name: "Chris Bryant",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Chris_Bryant",
  },
  {
    id: "peter-kyle",
    name: "Peter Kyle",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Peter_Kyle_(politician)",
  },
  {
    id: "stephen-flynn",
    name: "Stephen Flynn",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Stephen_Flynn_(politician)",
  },
  {
    id: "richard-tice",
    name: "Richard Tice",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Richard_Tice",
  },
  {
    id: "neil-kinnock",
    name: "Neil Kinnock",
    country: "UK",
    gender: "male",
    ethnicity: "white",
    wikiSlug: "Neil_Kinnock",
  },

  // ── UK — White Female ─────────────────────────────────────────────────────
  {
    id: "theresa-may",
    name: "Theresa May",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Theresa_May",
  },
  {
    id: "liz-truss",
    name: "Liz Truss",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Liz_Truss",
  },
  {
    id: "nicola-sturgeon",
    name: "Nicola Sturgeon",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Nicola_Sturgeon",
  },
  {
    id: "ruth-davidson",
    name: "Ruth Davidson",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Ruth_Davidson",
  },
  {
    id: "yvette-cooper",
    name: "Yvette Cooper",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Yvette_Cooper",
  },
  {
    id: "bridget-phillipson",
    name: "Bridget Phillipson",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Bridget_Phillipson",
  },
  {
    id: "caroline-lucas",
    name: "Caroline Lucas",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Caroline_Lucas",
  },
  {
    id: "harriet-harman",
    name: "Harriet Harman",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Harriet_Harman",
  },
  {
    id: "penny-mordaunt",
    name: "Penny Mordaunt",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Penny_Mordaunt",
  },
  {
    id: "angela-rayner",
    name: "Angela Rayner",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Angela_Rayner",
  },
  {
    id: "rachel-reeves",
    name: "Rachel Reeves",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Rachel_Reeves",
  },
  {
    id: "lucy-powell",
    name: "Lucy Powell",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Lucy_Powell",
  },
  {
    id: "joanna-cherry",
    name: "Joanna Cherry",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Joanna_Cherry",
  },
  {
    id: "natalie-bennett",
    name: "Natalie Bennett",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Natalie_Bennett",
  },
  {
    id: "kirsty-blackman",
    name: "Kirsty Blackman",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Kirsty_Blackman",
  },
  {
    id: "ann-widdecombe",
    name: "Ann Widdecombe",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Ann_Widdecombe",
  },
  {
    id: "margaret-thatcher",
    name: "Margaret Thatcher",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Margaret_Thatcher",
  },
  {
    id: "wera-hobhouse",
    name: "Wera Hobhouse",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Wera_Hobhouse",
  },
  {
    id: "stella-creasy",
    name: "Stella Creasy",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Stella_Creasy",
  },
  {
    id: "emily-thornberry",
    name: "Emily Thornberry",
    country: "UK",
    gender: "female",
    ethnicity: "white",
    wikiSlug: "Emily_Thornberry",
  },

  // ── UK — South Asian ──────────────────────────────────────────────────────
  {
    id: "rishi-sunak",
    name: "Rishi Sunak",
    country: "UK",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Rishi_Sunak",
  },
  {
    id: "sajid-javid",
    name: "Sajid Javid",
    country: "UK",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Sajid_Javid",
  },
  {
    id: "alok-sharma",
    name: "Alok Sharma",
    country: "UK",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Alok_Sharma",
  },
  {
    id: "nadhim-zahawi",
    name: "Nadhim Zahawi",
    country: "UK",
    gender: "male",
    ethnicity: "asian",
    wikiSlug: "Nadhim_Zahawi",
  },
  {
    id: "suella-braverman",
    name: "Suella Braverman",
    country: "UK",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Suella_Braverman",
  },
  {
    id: "priti-patel",
    name: "Priti Patel",
    country: "UK",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Priti_Patel",
  },
  {
    id: "seema-malhotra",
    name: "Seema Malhotra",
    country: "UK",
    gender: "female",
    ethnicity: "asian",
    wikiSlug: "Seema_Malhotra",
  },

  // ── UK — Black Male ───────────────────────────────────────────────────────
  {
    id: "david-lammy",
    name: "David Lammy",
    country: "UK",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "David_Lammy",
  },
  {
    id: "clive-lewis",
    name: "Clive Lewis",
    country: "UK",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Clive_Lewis_(politician)",
  },
  {
    id: "wes-streeting",
    name: "Wes Streeting",
    country: "UK",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Wes_Streeting",
  },
  {
    id: "shaun-bailey",
    name: "Shaun Bailey",
    country: "UK",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Shaun_Bailey",
  },
  {
    id: "bim-afolami",
    name: "Bim Afolami",
    country: "UK",
    gender: "male",
    ethnicity: "black",
    wikiSlug: "Bim_Afolami",
  },

  // ── UK — Black Female ─────────────────────────────────────────────────────
  {
    id: "kemi-badenoch",
    name: "Kemi Badenoch",
    country: "UK",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Kemi_Badenoch",
  },
  {
    id: "diane-abbott",
    name: "Diane Abbott",
    country: "UK",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Diane_Abbott",
  },
  {
    id: "dawn-butler",
    name: "Dawn Butler",
    country: "UK",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Dawn_Butler",
  },
  {
    id: "chi-onwurah",
    name: "Chi Onwurah",
    country: "UK",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Chi_Onwurah",
  },
  {
    id: "florence-eshalomi",
    name: "Florence Eshalomi",
    country: "UK",
    gender: "female",
    ethnicity: "black",
    wikiSlug: "Florence_Eshalomi",
  },
];

// ─── Fetch logic ──────────────────────────────────────────────────────────────

async function fetchThumbnail(wikiSlug: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiSlug)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AHD-NPP-Image-Seeder/1.0 (political simulation game; contact via github)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${wikiSlug}`);
      return null;
    }
    const data = (await res.json()) as { thumbnail?: { source?: string } };
    const src = data.thumbnail?.source;
    if (!src) return null;
    // Upsize to 400px
    return src.replace(/\/\d+px-/, "/400px-");
  } catch (err) {
    console.warn(`  Fetch error for ${wikiSlug}:`, (err as Error).message);
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const outputPath = path.join(process.cwd(), "src", "data", "npp-politician-images.json");

  // Load existing data so we can skip already-fetched entries
  let existing: PoliticianImage[] = [];
  if (fs.existsSync(outputPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outputPath, "utf-8")) as PoliticianImage[];
    } catch {
      existing = [];
    }
  }
  const existingIds = new Set(existing.map((e) => e.id));

  const results: PoliticianImage[] = [...existing];
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const politician of POLITICIANS) {
    if (existingIds.has(politician.id)) {
      skipped++;
      continue;
    }

    process.stdout.write(`Fetching ${politician.name} (${politician.country})... `);
    const url = await fetchThumbnail(politician.wikiSlug);

    if (url) {
      results.push({
        id: politician.id,
        name: politician.name,
        country: politician.country,
        gender: politician.gender,
        ethnicity: politician.ethnicity,
        url,
      });
      process.stdout.write(`✓\n`);
      fetched++;
    } else {
      process.stdout.write(`✗ (no image)\n`);
      failed++;
    }

    // Polite rate limiting
    await sleep(200);
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nDone. Fetched: ${fetched}, Skipped (existing): ${skipped}, Failed: ${failed}`);
  console.log(`Total images: ${results.length} → ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
