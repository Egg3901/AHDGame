/**
 * Player-facing bucket names, in each country's own language.
 *
 * The Layer-1 bucket keys are internal and English-ish (`no_qualifications`,
 * `berufsausbildung`, `branco`). Humanising them gave "No Qualifications" and
 * "Branco" — neither the country's real term nor consistent copy. These are the
 * terms those electorates actually use for themselves.
 *
 * SCRIPT RULE
 * -----------
 * Latin-script languages get the native term alone: a player reading a German
 * world sees "Hochschulabschluss", which is both authentic and legible.
 * Non-Latin scripts (JP, CN, RU, GR) get the native term followed by an English
 * gloss — "大学卒 (University)" — because a picker nobody can read is not a
 * feature, and the targeting UI has to stay usable for every player regardless
 * of the world they are in.
 *
 * A country absent from this table falls back to the US labels and then to a
 * humanised key, so a new seed renders unpolished rather than blank.
 */

export interface CountryBucketLabels {
  /** Dimension headers, e.g. `education` → "Bildung". */
  dims: Record<string, string>;
  /** `dim` → bucket key → label. */
  buckets: Record<string, Record<string, string>>;
}

/** Age bands are the same four keys everywhere; only the words change. */
const AGE_EN = {
  young: "Under 30s",
  mid: "30s and 40s",
  mature: "50s and 60s",
  senior: "Over 65s",
};
const INCOME_EN = { low: "Lower income", middle: "Middle income", high: "Higher income" };
const URBAN_EN = { urban: "Cities", suburban: "Suburbs", rural: "Countryside" };
const DIMS_EN = {
  ethnicity: "Background",
  age: "Age",
  education: "Education",
  income: "Income",
  urbanization: "Where they live",
};

const AGE_DE = { young: "Unter 30", mid: "30 bis 49", mature: "50 bis 64", senior: "Über 65" };
const INCOME_DE = {
  low: "Geringes Einkommen",
  middle: "Mittleres Einkommen",
  high: "Hohes Einkommen",
};
const DIMS_DE = {
  ethnicity: "Herkunft",
  age: "Alter",
  education: "Bildung",
  income: "Einkommen",
  urbanization: "Wohnort",
};

const UK_LABELS: CountryBucketLabels = {
  dims: DIMS_EN,
  buckets: {
    ethnicity: {
      white_british: "White British",
      asian_british: "Asian British",
      black_british: "Black British",
      mixed: "Mixed heritage",
      other: "Other backgrounds",
    },
    age: AGE_EN,
    education: {
      no_qualifications: "No qualifications",
      gcse_equivalent: "GCSEs",
      a_level_equivalent: "A-levels",
      degree_plus: "Degree or higher",
    },
    income: INCOME_EN,
    urbanization: URBAN_EN,
  },
};

export const COUNTRY_BUCKET_LABELS: Record<string, CountryBucketLabels> = {
  UK: UK_LABELS,

  IE: {
    dims: DIMS_EN,
    buckets: {
      ethnicity: {
        irish: "Irish",
        uk_british: "British",
        eu_other: "Other EU",
        rest_of_world: "Rest of the world",
      },
      age: AGE_EN,
      education: {
        primary_or_less: "Primary or less",
        leaving_cert: "Leaving Certificate",
        post_secondary: "Post-Leaving Cert",
        third_level: "Third level",
      },
      income: INCOME_EN,
      urbanization: URBAN_EN,
    },
  },

  // English is Nigeria's official language, so no gloss is needed. Faith is a
  // real dimension here and no other country has it.
  NG: {
    dims: { ...DIMS_EN, religion: "Faith" },
    buckets: {
      religion: {
        muslim: "Muslims",
        christian: "Christians",
        other: "Traditional and other faiths",
      },
      ethnicity: {
        hausa_fulani: "Hausa-Fulani",
        yoruba: "Yoruba",
        igbo: "Igbo",
        minority: "Minority groups",
      },
      age: AGE_EN,
      education: {
        basic: "Basic education",
        secondary: "Secondary school",
        tertiary: "Tertiary education",
      },
      income: INCOME_EN,
      urbanization: { urban: "Cities", suburban: "Peri-urban", rural: "Rural" },
    },
  },

  DE: {
    dims: DIMS_DE,
    buckets: {
      ethnicity: {
        german: "Deutsche",
        turkish_russian_diaspora: "Türkische und russische Community",
        mena: "Nahost und Nordafrika",
        eu_southern_eastern: "Süd- und Osteuropa",
        other: "Andere Herkunft",
      },
      age: AGE_DE,
      education: {
        no_degree: "Ohne Abschluss",
        berufsausbildung: "Berufsausbildung",
        abitur: "Abitur",
        hochschulabschluss: "Hochschulabschluss",
      },
      income: INCOME_DE,
      urbanization: { urban: "Großstadt", suburban: "Umland", rural: "Ländlicher Raum" },
    },
  },

  // East Germany: English UI labels aligned with region census cards (ticket #1121).
  DD: {
    dims: DIMS_EN,
    buckets: {
      ethnicity: { german: "German", other: "Other" },
      age: AGE_EN,
      education: {
        primary_or_below: "Primary or below",
        secondary: "Secondary",
        vocational: "Vocational",
        university: "University",
      },
      income: INCOME_EN,
      urbanization: URBAN_EN,
    },
  },

  AT: {
    dims: DIMS_DE,
    buckets: {
      ethnicity: { austrian: "Österreicher", minority: "Minderheiten", other: "Andere Herkunft" },
      age: AGE_DE,
      education: {
        primary_or_below: "Pflichtschule",
        secondary: "Matura",
        vocational: "Lehre",
        university: "Hochschulabschluss",
      },
      income: INCOME_DE,
      urbanization: { urban: "Stadt", suburban: "Umland", rural: "Ländlicher Raum" },
    },
  },

  BR: {
    dims: {
      ethnicity: "Origem",
      age: "Idade",
      education: "Escolaridade",
      income: "Renda",
      urbanization: "Onde vivem",
    },
    buckets: {
      ethnicity: {
        branco: "Brancos",
        pardo: "Pardos",
        preto: "Pretos",
        amarelo: "Amarelos",
        indigena: "Indígenas",
      },
      age: {
        young: "Menores de 30",
        mid: "30 a 49 anos",
        mature: "50 a 64 anos",
        senior: "Acima de 65",
      },
      education: {
        fundamental: "Ensino fundamental",
        medio: "Ensino médio",
        superior: "Ensino superior",
      },
      income: { low: "Baixa renda", middle: "Renda média", high: "Alta renda" },
      urbanization: { urban: "Cidades", suburban: "Periferia", rural: "Zona rural" },
    },
  },

  FR: {
    dims: {
      ethnicity: "Origine",
      age: "Âge",
      education: "Diplôme",
      income: "Revenus",
      urbanization: "Lieu de vie",
    },
    buckets: {
      ethnicity: {
        french: "Français",
        european_immigrant: "Immigration européenne",
        north_african: "Maghrébins",
        other: "Autres origines",
      },
      age: {
        young: "Moins de 30 ans",
        mid: "30 à 49 ans",
        mature: "50 à 64 ans",
        senior: "Plus de 65 ans",
      },
      education: {
        primary_or_below: "Sans diplôme",
        secondary: "Baccalauréat",
        vocational: "Formation professionnelle",
        university: "Études supérieures",
      },
      income: { low: "Bas revenus", middle: "Revenus moyens", high: "Hauts revenus" },
      urbanization: { urban: "Villes", suburban: "Banlieues", rural: "Campagne" },
    },
  },

  IT: {
    dims: {
      ethnicity: "Origine",
      age: "Età",
      education: "Istruzione",
      income: "Reddito",
      urbanization: "Dove vivono",
    },
    buckets: {
      ethnicity: { italian: "Italiani", immigrant: "Immigrati", other: "Altre origini" },
      age: {
        young: "Sotto i 30",
        mid: "30-49 anni",
        mature: "50-64 anni",
        senior: "Over 65",
      },
      education: {
        primary_or_below: "Licenza elementare",
        secondary: "Diploma",
        vocational: "Formazione professionale",
        university: "Laurea",
      },
      income: { low: "Redditi bassi", middle: "Redditi medi", high: "Redditi alti" },
      urbanization: { urban: "Città", suburban: "Periferie", rural: "Aree rurali" },
    },
  },

  ES: {
    dims: {
      ethnicity: "Origen",
      age: "Edad",
      education: "Estudios",
      income: "Renta",
      urbanization: "Dónde viven",
    },
    buckets: {
      ethnicity: {
        spanish: "Españoles",
        regional: "Nacionalidades históricas",
        other: "Otros orígenes",
      },
      age: {
        young: "Menores de 30",
        mid: "30 a 49 años",
        mature: "50 a 64 años",
        senior: "Mayores de 65",
      },
      education: {
        primary_or_below: "Sin estudios",
        secondary: "Bachillerato",
        vocational: "Formación profesional",
        university: "Estudios universitarios",
      },
      income: { low: "Rentas bajas", middle: "Rentas medias", high: "Rentas altas" },
      urbanization: { urban: "Ciudades", suburban: "Extrarradio", rural: "España rural" },
    },
  },

  SE: {
    dims: {
      ethnicity: "Bakgrund",
      age: "Ålder",
      education: "Utbildning",
      income: "Inkomst",
      urbanization: "Var de bor",
    },
    buckets: {
      ethnicity: { swedish: "Svenskar", immigrant: "Utrikes födda", other: "Övriga" },
      age: { young: "Under 30", mid: "30–49 år", mature: "50–64 år", senior: "Över 65" },
      education: {
        primary_or_below: "Grundskola",
        secondary: "Gymnasium",
        vocational: "Yrkesutbildning",
        university: "Högskola",
      },
      income: { low: "Låg inkomst", middle: "Medelinkomst", high: "Hög inkomst" },
      urbanization: { urban: "Storstad", suburban: "Förort", rural: "Landsbygd" },
    },
  },

  FI: {
    dims: {
      ethnicity: "Tausta",
      age: "Ikä",
      education: "Koulutus",
      income: "Tulot",
      urbanization: "Asuinpaikka",
    },
    buckets: {
      ethnicity: { finnish: "Suomalaiset", minority: "Vähemmistöt", other: "Muut taustat" },
      age: { young: "Alle 30", mid: "30–49 v", mature: "50–64 v", senior: "Yli 65" },
      education: {
        primary_or_below: "Peruskoulu",
        secondary: "Lukio",
        vocational: "Ammatillinen koulutus",
        university: "Korkeakoulu",
      },
      income: { low: "Pienituloiset", middle: "Keskituloiset", high: "Suurituloiset" },
      urbanization: { urban: "Kaupungit", suburban: "Lähiöt", rural: "Maaseutu" },
    },
  },

  TR: {
    dims: {
      ethnicity: "Köken",
      age: "Yaş",
      education: "Eğitim",
      income: "Gelir",
      urbanization: "Yaşadıkları yer",
    },
    buckets: {
      ethnicity: { turkish: "Türkler", kurdish: "Kürtler", other: "Diğer kökenler" },
      age: { young: "30 yaş altı", mid: "30–49 yaş", mature: "50–64 yaş", senior: "65 yaş üstü" },
      education: {
        primary_or_below: "İlkokul ve altı",
        secondary: "Lise",
        vocational: "Meslek okulu",
        university: "Üniversite",
      },
      income: { low: "Düşük gelir", middle: "Orta gelir", high: "Yüksek gelir" },
      // "Banliyö", not the colloquial "varoş", which is pejorative.
      urbanization: { urban: "Şehirler", suburban: "Banliyö", rural: "Kırsal" },
    },
  },

  // ── Non-Latin scripts: native term + English gloss ──────────────────────────

  JP: {
    dims: {
      ethnicity: "出身 (Background)",
      age: "年齢 (Age)",
      education: "学歴 (Education)",
      income: "所得 (Income)",
      urbanization: "居住地 (Where they live)",
    },
    buckets: {
      ethnicity: {
        japanese: "日本人 (Japanese)",
        chinese: "中国系 (Chinese)",
        korean: "韓国・朝鮮系 (Korean)",
        southeast_asian: "東南アジア系 (Southeast Asian)",
        other_foreign: "その他の外国系 (Other foreign)",
      },
      age: {
        young: "30歳未満 (Under 30)",
        mid: "30〜49歳 (30s and 40s)",
        mature: "50〜64歳 (50s and 60s)",
        senior: "65歳以上 (Over 65)",
      },
      education: {
        primary_or_below: "小学校卒以下 (Primary or below)",
        high_school: "高校卒 (High school)",
        vocational: "専門学校卒 (Vocational)",
        university: "大学卒 (University)",
        graduate: "大学院卒 (Graduate)",
      },
      income: {
        low: "低所得 (Lower income)",
        middle: "中所得 (Middle income)",
        high: "高所得 (Higher income)",
      },
      urbanization: {
        urban: "都市部 (Cities)",
        suburban: "郊外 (Suburbs)",
        rural: "地方 (Rural)",
      },
    },
  },

  CN: {
    dims: {
      ethnicity: "民族 (Background)",
      age: "年龄 (Age)",
      education: "教育 (Education)",
      income: "收入 (Income)",
      urbanization: "居住地 (Where they live)",
    },
    buckets: {
      ethnicity: {
        han: "汉族 (Han)",
        zhuang: "壮族 (Zhuang)",
        hui: "回族 (Hui)",
        uyghur: "维吾尔族 (Uyghur)",
        tibetan: "藏族 (Tibetan)",
        other_minority: "其他少数民族 (Other minorities)",
      },
      age: {
        young: "30岁以下 (Under 30)",
        mid: "30–49岁 (30s and 40s)",
        mature: "50–64岁 (50s and 60s)",
        senior: "65岁以上 (Over 65)",
      },
      education: {
        primary_or_below: "小学及以下 (Primary or below)",
        secondary: "中学 (Secondary)",
        vocational: "职业教育 (Vocational)",
        university: "大学 (University)",
      },
      income: {
        low: "低收入 (Lower income)",
        middle: "中等收入 (Middle income)",
        high: "高收入 (Higher income)",
      },
      urbanization: {
        urban: "城市 (Cities)",
        suburban: "城郊 (Suburbs)",
        rural: "农村 (Rural)",
      },
    },
  },

  RU: {
    dims: {
      ethnicity: "Происхождение (Background)",
      age: "Возраст (Age)",
      education: "Образование (Education)",
      income: "Доход (Income)",
      urbanization: "Место жительства (Where they live)",
    },
    buckets: {
      ethnicity: {
        russian: "Русские (Russians)",
        ukrainian: "Украинцы (Ukrainians)",
        central_asian: "Народы Средней Азии (Central Asian)",
        caucasian: "Народы Кавказа (Caucasus peoples)",
        other: "Другие народы (Other peoples)",
      },
      age: {
        young: "До 30 лет (Under 30)",
        mid: "30–49 лет (30s and 40s)",
        mature: "50–64 года (50s and 60s)",
        senior: "Старше 65 (Over 65)",
      },
      education: {
        primary_or_below: "Начальное образование (Primary or below)",
        secondary: "Среднее образование (Secondary)",
        vocational: "Профессиональное образование (Vocational)",
        university: "Высшее образование (University)",
      },
      income: {
        low: "Низкий доход (Lower income)",
        middle: "Средний доход (Middle income)",
        high: "Высокий доход (Higher income)",
      },
      urbanization: {
        urban: "Города (Cities)",
        suburban: "Пригороды (Suburbs)",
        rural: "Село (Rural)",
      },
    },
  },

  GR: {
    dims: {
      ethnicity: "Καταγωγή (Background)",
      age: "Ηλικία (Age)",
      education: "Εκπαίδευση (Education)",
      income: "Εισόδημα (Income)",
      urbanization: "Τόπος διαμονής (Where they live)",
    },
    buckets: {
      ethnicity: {
        greek: "Έλληνες (Greeks)",
        minority: "Μειονότητες (Minorities)",
        other: "Άλλες καταγωγές (Other backgrounds)",
      },
      age: {
        young: "Κάτω των 30 (Under 30)",
        mid: "30–49 (30s and 40s)",
        mature: "50–64 (50s and 60s)",
        senior: "Άνω των 65 (Over 65)",
      },
      education: {
        primary_or_below: "Δημοτικό ή λιγότερο (Primary or below)",
        secondary: "Λύκειο (Secondary)",
        vocational: "Επαγγελματική εκπαίδευση (Vocational)",
        university: "Πανεπιστήμιο (University)",
      },
      income: {
        low: "Χαμηλό εισόδημα (Lower income)",
        middle: "Μεσαίο εισόδημα (Middle income)",
        high: "Υψηλό εισόδημα (Higher income)",
      },
      urbanization: {
        urban: "Πόλεις (Cities)",
        suburban: "Προάστια (Suburbs)",
        rural: "Επαρχία (Rural)",
      },
    },
  },
  // ── Eastern bloc ───────────────────────────────────────────────────────────
  // These eight have Layer-1 models and had NO label table, so every bucket
  // rendered as a humanised key. The coverage test could not catch it: it
  // iterated this object's own keys, so a country absent from here was absent
  // from the check too. It now walks the models instead.

  HU: {
    dims: {
      ethnicity: "Származás",
      age: "Életkor",
      education: "Végzettség",
      income: "Jövedelem",
      urbanization: "Lakóhely",
    },
    buckets: {
      ethnicity: { hungarian: "Magyarok", minority: "Kisebbségek", other: "Egyéb származás" },
      age: { young: "30 alatt", mid: "30–49 év", mature: "50–64 év", senior: "65 felett" },
      education: {
        primary_or_below: "Általános iskola",
        secondary: "Középiskola",
        vocational: "Szakképzés",
        university: "Felsőfokú",
      },
      income: {
        low: "Alacsony jövedelem",
        middle: "Közepes jövedelem",
        high: "Magas jövedelem",
      },
      urbanization: { urban: "Városok", suburban: "Elővárosok", rural: "Vidék" },
    },
  },

  PL: {
    dims: {
      ethnicity: "Pochodzenie",
      age: "Wiek",
      education: "Wykształcenie",
      income: "Dochód",
      urbanization: "Miejsce zamieszkania",
    },
    buckets: {
      ethnicity: { polish: "Polacy", minority: "Mniejszości", other: "Inne pochodzenie" },
      age: { young: "Poniżej 30", mid: "30–49 lat", mature: "50–64 lata", senior: "Powyżej 65" },
      education: {
        primary_or_below: "Podstawowe",
        secondary: "Średnie",
        vocational: "Zawodowe",
        university: "Wyższe",
      },
      income: { low: "Niskie dochody", middle: "Średnie dochody", high: "Wysokie dochody" },
      urbanization: { urban: "Miasta", suburban: "Przedmieścia", rural: "Wieś" },
    },
  },

  RO: {
    dims: {
      ethnicity: "Origine",
      age: "Vârstă",
      education: "Educație",
      income: "Venit",
      urbanization: "Unde locuiesc",
    },
    buckets: {
      ethnicity: { romanian: "Români", hungarian: "Maghiari", other: "Alte origini" },
      age: { young: "Sub 30", mid: "30–49 ani", mature: "50–64 ani", senior: "Peste 65" },
      education: {
        primary_or_below: "Școala primară",
        secondary: "Liceu",
        vocational: "Școală profesională",
        university: "Studii superioare",
      },
      income: { low: "Venituri mici", middle: "Venituri medii", high: "Venituri mari" },
      urbanization: { urban: "Orașe", suburban: "Periferii", rural: "Sate" },
    },
  },

  // Serbo-Croatian in Latin script, as Yugoslavia itself used alongside Cyrillic.
  YU: {
    dims: {
      ethnicity: "Porijeklo",
      age: "Dob",
      education: "Obrazovanje",
      income: "Prihod",
      urbanization: "Gdje žive",
    },
    buckets: {
      ethnicity: { south_slav: "Južni Slaveni", albanian: "Albanci", other: "Ostalo porijeklo" },
      age: {
        young: "Ispod 30",
        mid: "30–49 godina",
        mature: "50–64 godine",
        senior: "Iznad 65",
      },
      education: {
        primary_or_below: "Osnovna škola",
        secondary: "Srednja škola",
        vocational: "Stručna škola",
        university: "Visoko obrazovanje",
      },
      income: { low: "Niski prihodi", middle: "Srednji prihodi", high: "Visoki prihodi" },
      urbanization: { urban: "Gradovi", suburban: "Predgrađa", rural: "Selo" },
    },
  },

  CS: {
    dims: {
      ethnicity: "Původ",
      age: "Věk",
      education: "Vzdělání",
      income: "Příjem",
      urbanization: "Kde žijí",
    },
    buckets: {
      ethnicity: { czech: "Češi", slovak: "Slováci", other: "Jiný původ" },
      age: { young: "Do 30", mid: "30–49 let", mature: "50–64 let", senior: "Nad 65" },
      education: {
        primary_or_below: "Základní škola",
        secondary: "Střední škola",
        vocational: "Učňovské",
        university: "Vysoká škola",
      },
      income: { low: "Nízké příjmy", middle: "Střední příjmy", high: "Vysoké příjmy" },
      urbanization: { urban: "Města", suburban: "Předměstí", rural: "Venkov" },
    },
  },

  // The Baltic model spans three languages with no shared native form, so it
  // takes English rather than arbitrarily picking one of them.
  BAL: {
    dims: DIMS_EN,
    buckets: {
      ethnicity: {
        baltic: "Baltic peoples",
        russian: "Russians",
        other: "Other backgrounds",
      },
      age: AGE_EN,
      education: {
        primary_or_below: "Primary or below",
        secondary: "Secondary",
        vocational: "Vocational",
        university: "University",
      },
      income: INCOME_EN,
      urbanization: URBAN_EN,
    },
  },

  BG: {
    dims: {
      ethnicity: "Произход (Background)",
      age: "Възраст (Age)",
      education: "Образование (Education)",
      income: "Доход (Income)",
      urbanization: "Местоживеене (Where they live)",
    },
    buckets: {
      ethnicity: {
        bulgarian: "Българи (Bulgarians)",
        turkish: "Турци (Turks)",
        other: "Друг произход (Other backgrounds)",
      },
      age: {
        young: "Под 30 (Under 30)",
        mid: "30–49 години (30s and 40s)",
        mature: "50–64 години (50s and 60s)",
        senior: "Над 65 (Over 65)",
      },
      education: {
        primary_or_below: "Основно образование (Primary or below)",
        secondary: "Средно образование (Secondary)",
        vocational: "Професионално образование (Vocational)",
        university: "Висше образование (University)",
      },
      income: {
        low: "Нисък доход (Lower income)",
        middle: "Среден доход (Middle income)",
        high: "Висок доход (Higher income)",
      },
      urbanization: {
        urban: "Градове (Cities)",
        suburban: "Предградия (Suburbs)",
        rural: "Село (Rural)",
      },
    },
  },

  // Ukraine. Same five dimensions as Byelorussia below, in Ukrainian. The
  // ethnicity buckets follow the seed's own keys, which stay `ukrainian` /
  // `russian` / `other` in both eras - the 1979 census's larger Russian share is
  // a change in the numbers, not in the categories.
  UKR: {
    dims: {
      ethnicity: "Походження (Background)",
      age: "Вік (Age)",
      education: "Освіта (Education)",
      income: "Дохід (Income)",
      urbanization: "Де живуть (Where they live)",
    },
    buckets: {
      ethnicity: {
        ukrainian: "Українці (Ukrainians)",
        russian: "Росіяни (Russians)",
        other: "Інше походження (Other backgrounds)",
      },
      age: {
        young: "До 30 (Under 30)",
        mid: "30–49 років (30s and 40s)",
        mature: "50–64 роки (50s and 60s)",
        senior: "Понад 65 (Over 65)",
      },
      education: {
        primary_or_below: "Початкова освіта (Primary or below)",
        secondary: "Середня освіта (Secondary)",
        vocational: "Професійна освіта (Vocational)",
        university: "Вища освіта (University)",
      },
      income: {
        low: "Низький дохід (Lower income)",
        middle: "Середній дохід (Middle income)",
        high: "Високий дохід (Higher income)",
      },
      urbanization: {
        urban: "Міста (Cities)",
        suburban: "Передмістя (Suburbs)",
        rural: "Село (Rural)",
      },
    },
  },

  BLR: {
    dims: {
      ethnicity: "Паходжанне (Background)",
      age: "Узрост (Age)",
      education: "Адукацыя (Education)",
      income: "Даход (Income)",
      urbanization: "Дзе жывуць (Where they live)",
    },
    buckets: {
      ethnicity: {
        belarusian: "Беларусы (Belarusians)",
        russian: "Рускія (Russians)",
        other: "Іншае паходжанне (Other backgrounds)",
      },
      age: {
        young: "Да 30 (Under 30)",
        mid: "30–49 гадоў (30s and 40s)",
        mature: "50–64 гады (50s and 60s)",
        senior: "Звыш 65 (Over 65)",
      },
      education: {
        primary_or_below: "Пачатковая адукацыя (Primary or below)",
        secondary: "Сярэдняя адукацыя (Secondary)",
        vocational: "Прафесійная адукацыя (Vocational)",
        university: "Вышэйшая адукацыя (University)",
      },
      income: {
        low: "Нізкі даход (Lower income)",
        middle: "Сярэдні даход (Middle income)",
        high: "Высокі даход (Higher income)",
      },
      urbanization: {
        urban: "Гарады (Cities)",
        suburban: "Прыгарады (Suburbs)",
        rural: "Вёска (Rural)",
      },
    },
  },
  // Devolved UK nations share the UK's buckets exactly, so they share its
  // labels. Aliased rather than copied: a second table would be free to drift
  // from the one it was copied from.
  SCO: UK_LABELS,
  WAL: UK_LABELS,
};

/** Countries whose labels carry an English gloss because the script is not Latin. */
export const GLOSSED_COUNTRIES = new Set(["JP", "CN", "RU", "GR", "BG", "UKR", "BLR"]);
