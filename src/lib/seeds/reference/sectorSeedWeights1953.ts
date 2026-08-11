/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 */

/**
 * 1953-era national sector weights, US only.
 *
 * Relative percentage-of-GDP allocations across the 17 game sectors, calibrated
 * to ~1953 BEA value-added shares — a *peak-manufacturing, defense-dominant,
 * pre-service-economy* era. Relative to the 1979 and later bundles:
 *   - manufacturing at its absolute PEAK (~25-30% of GDP; WWII-built capacity
 *     running at full tilt; autos, steel, chemicals, rubber all dominant)
 *   - defense VERY HIGH (~14% of GDP; Korean War + NATO nuclear buildup; the
 *     largest peacetime defense share in US history)
 *   - automobiles VERY HIGH (Big Three: GM/Ford/Chrysler have ~100% of US market;
 *     no Japanese/European competition; GI Bill + suburbs driving sales)
 *   - agriculture high (~8% of GDP; farm sector still ~15% of labor force)
 *   - energy high (coal ~51% of primary energy; oil/gas growing; no nuclear yet)
 *   - chemical_industries elevated (DuPont-era; postwar plastics/synthetic rubber boom)
 *   - construction elevated (Levittown suburban boom; GI Bill mortgages)
 *   - technology NEAR ZERO (ENIAC-era; no commercial computers; no silicon)
 *   - telecommunications LOW (AT&T monopoly; all landlines; no TV advertising scale yet)
 *   - financial LOW (Glass-Steagall in full force; no derivatives; regulated rates)
 *   - healthcare LOW (pre-Medicare/Medicaid; mostly private cash-pay; tiny sector)
 *   - media LOW (newspapers peak; TV just emerging; no cable)
 *   - entertainment LOW (Hollywood declining post-HUAC; early TV eating cinema)
 *   - retail moderate (pre-mall era; downtown department stores; no national chains)
 *   - real_estate lower than 1979 (low mortgage rates via FHA/VA but small market)
 *   - logistics moderate (truck + rail; pre-Interstate; trucking regulated)
 * All weights are normalised at read time, so only relative magnitudes matter.
 *
 * Other countries remain on the 2019-default weights until country-specific
 * 1953 data is authored. `getCountrySectorWeights1953` returns an even
 * distribution for any country not in the map.
 */

import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";

type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_1953: Record<string, SectorWeightMap> = {
  US: {
    manufacturing: 26, // absolute peak; steel/rubber/textiles/machinery dominant
    defense: 14, // Korean War + NATO buildup; largest peacetime defense share
    automobiles: 10, // Big Three 100% US market share; suburban expansion
    agriculture: 8, // farm sector still large; ~15% of workforce
    energy: 7, // coal dominant; oil/gas growing; no nuclear power yet
    construction: 6, // Levittown; GI Bill suburban boom; roads
    chemical_industries: 5, // DuPont era; synthetic rubber/plastics postwar boom
    retail: 5, // downtown department stores; no national chains yet
    real_estate: 4, // FHA/VA mortgages; suburban lots; small by later standards
    logistics: 4, // rail + truck regulated; pre-Interstate
    financial: 3, // Glass-Steagall; regulated deposit rates; small sector
    healthcare: 2, // mostly private cash-pay; tiny by modern standards
    media: 2, // newspapers + 3 TV networks (just launching); print dominant
    telecommunications: 2, // AT&T monopoly; landlines only; no cable
    entertainment: 2, // Hollywood declining; early TV disrupting cinema
    extraction: 2, // coal mining; oil drilling; copper; competitive
    technology: 0, // essentially zero commercial sector; ENIAC-era; no silicon
  },
  UK: {
    manufacturing: 28, // British industry at postwar zenith; textiles, steel, shipbuilding
    energy: 10, // nationalised coal (NCB); still rationing fuel until 1950, oil recovering
    construction: 8, // Attlee housing programme; Festival of Britain; postwar rebuild
    agriculture: 6, // nationalised support; ~5% of GDP; rationing ended 1954
    chemical_industries: 6, // ICI; wartime chemicals converted to peacetime
    logistics: 5, // nationalised railways (British Railways, 1948)
    retail: 5, // Co-op + High Street; no supermarkets yet
    financial: 5, // City of London recovering; sterling area; capital controls
    defense: 4, // Korea + Suez build-up; national service; NATO commitments
    real_estate: 4, // council house building boom; land values still depressed
    automobiles: 3, // BMC/Rover/Jaguar; mass-market cars just emerging
    telecommunications: 2, // GPO telephone monopoly; BBC national radio
    media: 2, // Fleet Street newspapers; BBC; no commercial TV (until 1955)
    healthcare: 2, // NHS founded 1948; growing but still nascent
    extraction: 2, // coal mining dominant; some North Sea oil speculation
    entertainment: 2, // cinemas still booming; pre-TV household penetration
    technology: 0, // Ferranti Mark 1 computer; no commercial market
  },
  DE: {
    manufacturing: 32, // Wirtschaftswunder beginning; Ruhr steel; Volkswagen; Siemens
    construction: 12, // Wiederaufbau (reconstruction) at peak; massive housing shortage
    automobiles: 8, // VW Beetle exports; Daimler; massive postwar growth
    chemical_industries: 8, // BASF/Bayer/Hoechst (IG Farben split 1952); world-class
    energy: 7, // Ruhr coal; electricity reconstruction; no nuclear yet
    retail: 5, // Kaufhof/Karstadt recovering; high savings rate
    logistics: 5, // DB (Deutsche Bundesbahn) modernising; Autobahn exists but bombed
    financial: 4, // Deutsche Bank recovering; DM stabilised 1948; Wirtschaftswunder credit
    agriculture: 3, // still significant; refugee farmers from East
    defense: 2, // FRG rearmament just approved (EDC Treaty 1952); small
    real_estate: 2, // huge shortage; Trümmerfrauen cleared rubble; new housing law
    telecommunications: 2, // Bundespost monopoly; rebuilding infrastructure
    media: 2, // ARD founded 1950; major newspapers rebuilding
    healthcare: 2, // public insurance (GKV) restored; rebuilding hospitals
    extraction: 2, // Ruhr coal; Saar still French; iron ore
    entertainment: 1, // cinemas rebuilding; Kino golden age
    technology: 0, // technical schools restarting; no commercial IT market
  },
  JP: {
    manufacturing: 30, // Korean War boom; US procurement accelerated recovery; steel/textiles
    agriculture: 12, // land reform (1947-50) complete; rice dominant; ~40% of labour
    construction: 10, // war destruction rebuilding; Japan Housing Corporation est. 1955 (just before)
    energy: 8, // coal dominant; electric power reconstruction (TEPCO etc.)
    automobiles: 5, // Toyota/Nissan just starting passenger cars; military trucks→civilian
    logistics: 5, // Japan National Railways rebuilding; port recovery
    chemical_industries: 4, // zaibatsu successor chemi-firms (Mitsui Chemicals)
    retail: 4, // department stores (depato) recovering; markets dominant
    defense: 3, // JSDF established 1954; US-Japan Security Treaty 1951; rearmament pressure
    financial: 3, // Bank of Japan; zaibatsu successor banks; capital controls
    extraction: 3, // coal mining (Kyushu/Hokkaido); copper/zinc
    real_estate: 2, // massive housing shortage from firebombing; small formal market
    healthcare: 2, // health insurance law 1958 pending; small but growing
    telecommunications: 2, // NTT predecessor; rebuilding
    media: 2, // Yomiuri/Asahi newspapers; NHK radio; TV just launching 1953
    entertainment: 2, // Toho/Toei cinema boom; Godzilla (1954); pachinko
    technology: 0, // transistors licensed from Bell Labs 1953 (Sony); zero commercial sector
  },
  CN: {
    agriculture: 35, // collectivization ongoing; ~80% of population rural peasants
    manufacturing: 20, // First Five-Year Plan (1953-57) launching; Soviet-aided industrialization
    construction: 12, // Soviet-aided factory and dam construction; new capital projects
    energy: 10, // coal dominant; Daqing oil discovered 1959 (not yet); Soviet help
    extraction: 6, // coal mining; iron ore; rare earths (early)
    defense: 6, // Korean War; PLA modernization; Soviet military aid
    logistics: 4, // rail network expanding under plan; rivers
    chemical_industries: 2, // Soviet-aided chemical plants starting
    financial: 2, // People's Bank of China monopoly; no private finance
    retail: 1, // state-run shops; market exchange suppressed
    real_estate: 1, // state-allocated housing; no market
    healthcare: 1, // barefoot doctors programme not yet; urban hospitals only
    telecommunications: 0, // limited; state telegraph
    media: 0, // People's Daily; CCTV predecessor; purely state propaganda
    automobiles: 0, // First Automobile Works 1953 (Changchun); just starting
    entertainment: 0, // opera/drama; cinema (socialist realism)
    technology: 0, // Soviet technical assistance; no commercial market
  },
  BR: {
    agriculture: 25, // coffee still ~50% of exports; São Paulo coffee planters; cattle
    manufacturing: 20, // Vargas-era import substitution; CSN steel; light industry
    construction: 12, // Getúlio Vargas public works; Volta Redonda steel
    energy: 8, // Petrobras founded 1953; hydroelectric; CHESF
    extraction: 6, // iron ore (CVRD); manganese; coffee beans
    logistics: 5, // rail + river; underdeveloped roads
    real_estate: 4, // Rio/São Paulo urban growth; favela expansion
    financial: 4, // BNDE (development bank) founded 1952; Banco do Brasil
    retail: 4, // open-air markets; street vendors; no supermarkets
    automobiles: 2, // Willys/Ford in Brazil just starting (officially 1956)
    defense: 2, // Korean War contribution; small military
    chemical_industries: 2, // Petrobras downstream planned; small
    telecommunications: 1, // Embratel predecessor; limited
    healthcare: 1, // INPS precursor; small urban sector
    media: 1, // rádio the dominant medium; O Globo newspaper
    entertainment: 1, // Bossa Nova era just beginning; carnaval; cinema
    technology: 0, // zero commercial IT
  },
  IE: {
    agriculture: 22, // farming ~27% of GDP; cattle exports to UK dominant
    manufacturing: 18, // protected infant industry; Guinness; Jacobs; small scale
    construction: 10, // Marshall Plan era; housing shortage in cities
    energy: 8, // ESB (1927) peat + coal; Shannon Scheme; oil imported
    retail: 8, // local shops; Co-op; limited chains
    logistics: 5, // CIÉ (nationalised rail+bus); underdeveloped roads
    financial: 5, // Central Bank tight control; sterling link; Bank of Ireland
    real_estate: 4, // housing programme; Land Commission redistribution
    defense: 2, // Defence Forces small (neutrality); no NATO
    telecommunications: 2, // P&T (Post & Telegraphs) monopoly
    media: 2, // Irish Times/Irish Press; Radio Éireann; no TV until 1961
    healthcare: 2, // Health Act 1953 (Mother and Child Scheme aftermath); small
    extraction: 1, // Bord na Móna peat; lead/zinc (Tara not yet)
    entertainment: 1, // cinemas; Gaelic games; dancehalls
    automobiles: 1, // imported; small assembly
    chemical_industries: 1, // small
    technology: 0,
  },
  NG: {
    agriculture: 45, // groundnuts/palm oil/cocoa; subsistence farming ~70% of population
    extraction: 15, // tin (Jos Plateau); columbite; coal (Enugu); timber
    construction: 10, // colonial infrastructure; roads; colonial buildings
    energy: 6, // coal; wood fuel; very limited electricity (Lagos/Ibadan)
    logistics: 5, // railway (narrow gauge); rivers; limited roads
    manufacturing: 5, // groundnut oil processing; cotton ginning; small light industry
    retail: 5, // market traders; Kingsway stores (Unilever); Lebanese merchants
    financial: 3, // Standard Bank; BBWA; colonial banking; no central bank yet
    real_estate: 2, // urban Lagos growing; colonial land ordinances
    healthcare: 2, // colonial hospitals; UCH Ibadan (just opened); mission hospitals
    media: 2, // Daily Times; radio (colonial); no TV until 1959
    defense: 2, // Royal West African Frontier Force; colonial garrison
    telecommunications: 1, // PTT limited; Lagos only
    automobiles: 0, // imported; no manufacturing
    chemical_industries: 0,
    entertainment: 1, // highlife music; cinema (Lebanese theatres in Lagos)
    technology: 0,
  },
  FR: {
    manufacturing: 25, // nationalised industries; Renault; steel; textiles
    agriculture: 15, // PAC precursor; ~25% of workforce; wine/wheat
    construction: 10, // postwar reconstruction (les Trente Glorieuses begins); HLM housing
    energy: 8, // EDF (nationalised 1946); coal (CHARBONNAGES); no nuclear yet
    automobiles: 6, // Renault (nationalised); Citroën 2CV (1948); Peugeot
    chemical_industries: 5, // Rhône-Poulenc; ATO; synthetic fibres
    financial: 5, // Banque de France; CIC; Crédit Lyonnais nationalised
    retail: 5, // épiceries; Printemps; Galeries Lafayette
    logistics: 4, // SNCF (nationalised 1937); bateaux; canal freight
    real_estate: 3, // HLM programme; rural depopulation
    defense: 3, // Indochina war; Korea; NATO; conscription
    telecommunications: 2, // PTT monopoly; limited TV (1953 launch)
    media: 2, // Le Monde; France-Soir; ORTF predecessor
    healthcare: 2, // Sécurité Sociale (1945); growing but rationed
    extraction: 2, // coal Lorraine; iron ore
    entertainment: 1, // cinemas (Nouvelle Vague imminent); music halls
    technology: 0, // Bull Gamma computing; zero commercial market
  },
  IT: {
    manufacturing: 24, // IRI companies; Fiat; Olivetti; Pirelli; textiles
    agriculture: 20, // southern agriculture; braccianti; land reform (1950)
    construction: 12, // postwar reconstruction; Cassa per il Mezzogiorno (1950)
    energy: 7, // ENI founded 1953; ENEL predecessor; Mattei oil/gas
    automobiles: 6, // Fiat 500 (1957 imminent); Alfa Romeo; Lancia; Vespa
    real_estate: 5, // urban migration beginning; housing boom
    retail: 5, // small shops; mercati; no supermarkets
    financial: 5, // Banca d'Italia; IRI banks; Mediobanca
    logistics: 4, // FS (Ferrovie dello Stato); underdeveloped south
    chemical_industries: 4, // Montecatini; ENI downstream
    defense: 2, // NATO member; conscription; small rearmament
    healthcare: 2, // INAM sickness fund; regional hospitals
    telecommunications: 2, // SIP/Telecom predecessor; limited rural
    media: 2, // Corriere della Sera; La Repubblica predecessor; RAI (1952)
    extraction: 1, // sulphur (Sicily); lead/zinc (Sardinia)
    entertainment: 1, // Cinecittà; Sophia Loren; festival season
    technology: 0, // Olivetti computing (Elea 9003 planned); zero commercial
  },
  ES: {
    agriculture: 25, // autarky food production; Francoist agrarian policy; ~48% of GDP
    manufacturing: 18, // Instituto Nacional de Industria (INI); self-sufficiency drive
    construction: 10, // Francoist public works; hydroelectric dams; regime monuments
    energy: 10, // hydroelectric (Franco's dam programme); coal; CAMPSA oil monopoly
    extraction: 6, // iron ore (Vizcaya); copper (Río Tinto, British-owned); potash
    logistics: 4, // RENFE (nationalised 1941); underdeveloped roads
    financial: 4, // Banco de España; INI credit; foreign exchange controls
    retail: 4, // local shops; black market (estraperlo); rationing
    real_estate: 3, // urban housing shortage; INV (housing institute)
    defense: 3, // Francoist army; US Bases Agreement 1953; NATO-adjacent
    telecommunications: 2, // CTNE (Telefónica, US-linked); limited
    media: 2, // NO-DO (regime newsreels); ABC; state radio (RNE)
    healthcare: 2, // SOE (Seguro Obligatorio de Enfermedad 1942); underfunded
    automobiles: 1, // SEAT (INI/Fiat) founded 1950; 1st Seat 1400 (1953)
    chemical_industries: 1, // small INI plants
    entertainment: 1, // flamenco; bullfighting; cinema (censored)
    technology: 0, // none
  },
  SE: {
    manufacturing: 26, // Volvo; SAAB; Ericsson; SKF; export-oriented; neutral wartime benefit
    energy: 10, // hydroelectric dominant (Vattenfall); nationalised; no nuclear yet
    agriculture: 8, // cooperative farming; milk/grain; ~15% of labour force
    construction: 8, // Million Programme (housing) just starting; postwar rebuild
    financial: 7, // Wallenberg banks; Riksbank; high savings rate
    automobiles: 6, // Volvo PV444; SAAB 92; growing domestic + export market
    logistics: 5, // SJ (state railways); extensive coast + inland waterways
    chemical_industries: 5, // AKZO Nobel predecessor; Nobel Industries; AGA
    retail: 5, // ICA/Konsum; co-operative model dominant
    defense: 4, // Cold War neutrality; large conscript army + SAAB jets
    real_estate: 3, // rent control; housing shortage; folkhemmet (People's Home)
    media: 2, // Aftonbladet; Expressen; SR radio; no TV until 1956
    telecommunications: 2, // Televerket monopoly; solid telephone penetration
    healthcare: 3, // nationalised healthcare (Lagen om allmän sjukförsäkring 1955 coming)
    extraction: 2, // Kiruna iron ore (LKAB); copper; forestry
    entertainment: 1, // Bergman films (1950s); cinema; folk music
    technology: 0, // Ericsson telephone equipment; zero commercial computing
  },
  GR: {
    agriculture: 38, // half the workforce; tobacco/olives/currants; smallholders
    logistics: 12, // the merchant marine boom (Onassis, Niarchos flags returning)
    construction: 10, // reconstruction + the antiparochi building boom beginning
    manufacturing: 10, // textiles; food processing; small workshops
    retail: 8, // shopkeeper economy
    energy: 6, // DEI (1950) electrification drive; Ptolemaida lignite surveyed
    extraction: 5, // lignite; bauxite; marble
    financial: 4, // National Bank of Greece dominance; drachma stabilising 1953
    real_estate: 4, // Athens influx; informal building
    defense: 3, // large post-civil-war army; NATO 1952
  },
  AT: {
    agriculture: 22, // a third of the workforce; Alpine dairy, grain in the east
    manufacturing: 20, // VOEST steel (LD process 1952!); nationalised heavy industry
    construction: 12, // ERP-funded reconstruction; Kaprun dam; housing rebuild
    energy: 8, // Alpine hydro build-out; SMV oil (Zistersdorf, under Soviet USIA)
    logistics: 7, // ÖBB electrification; Danube shipping; Alpine transit
    retail: 7, // small shopkeepers; Konsum co-operatives
    extraction: 5, // Erzberg iron ore; magnesite; salt
    financial: 5, // nationalised big banks (CA, Länderbank) steering credit
    real_estate: 4, // Vienna Gemeindebau reconstruction
    healthcare: 3, // Krankenkassen system rebuilt
    entertainment: 3, // tourism restarting (Salzburg festivals, Alpine resorts)
    media: 2, // party press; RAVAG radio under four-power control
    telecommunications: 1, // PTT telephone rebuild
    defense: 1, // no army until 1955; B-Gendarmerie cadres only
  },
  FI: {
    agriculture: 30, // ~40% of workforce; smallholder farms swollen by Karelian resettlement
    manufacturing: 18, // forest products + the reparations-built metal industry (Valmet)
    extraction: 10, // forestry itself: logging the green gold
    construction: 9, // resettlement housing; Oulujoki hydro dams
    logistics: 7, // VR railways; timber floating; icebreaker-kept ports
    energy: 6, // hydro build-out racing demand
    retail: 6, // co-operative movement (SOK/OTK) dominant
    financial: 4, // bank-group blocs (KOP vs SYP) steering industry
    real_estate: 3, // Helsinki housing shortage; Arava state-loan building
    defense: 2, // Paris-treaty-capped conscript force
    healthcare: 2, // municipal hospitals; sickness insurance not yet (1964)
    media: 2, // strong party press; Yleisradio
    telecommunications: 1, // sparse rural telephone network
  },
  TR: {
    agriculture: 40, // ~75% of population rural; wheat/cotton/tobacco; Marshall Aid farms
    manufacturing: 14, // Sümerbank state enterprises; textiles; cement; sugar
    construction: 10, // Menderes modernisation; new roads; Ankara Hilton (1955)
    energy: 8, // coal (TTK Zonguldak); hydroelectric; TPAO oil exploration
    logistics: 6, // TCDD railways expanding; underdeveloped roads; Black Sea ports
    extraction: 5, // chrome; copper; boron; coal
    real_estate: 3, // urban migration to Ankara/Istanbul beginning; gecekondu
    financial: 3, // Merkez Bankası; T. İş Bankası; İş Bankası; tight state control
    retail: 3, // bazaar/çarşı markets; local shops
    defense: 3, // Korean War (1950-53); NATO member 1952; large conscript army
    healthcare: 1, // SSK (Social Insurance) limited; urban hospitals only
    telecommunications: 1, // PTT monopoly; very limited telephone
    media: 1, // Cumhuriyet; Hürriyet (1948); radio (TRT predecessor)
    automobiles: 0, // some Ford/Chevrolet trucks; no local production
    chemical_industries: 0, // MKE chemicals; very small
    entertainment: 1, // Yeşilçam films starting; music; wrestling
    technology: 0, // none
  },
  SU: {
    manufacturing: 25, // Stalinist heavy industry at peak; steel/coal/machinebuilding priority
    defense: 18, // Korean War + Stalin's military budget; atom bomb (1949) + H-bomb (1953); largest share
    energy: 12, // coal dominant; oil (Baku); hydroelectric (GOELRO plan); nuclear just starting
    construction: 10, // Stalin's "Seven Sisters" skyscrapers; dam/canal projects; post-WWII rebuild
    agriculture: 8, // collective farms; Stalin starved sector; grain below pre-1917 per capita
    extraction: 8, // coal; iron ore; oil; gold (Kolyma Gulag labour); strategic metals
    chemical_industries: 5, // synthetic rubber; explosives; fertilizer for collectivized farms
    logistics: 5, // Soviet Railways; Volga-Don Canal (1952); limited trucks
    telecommunications: 2, // state monopoly; party/military priority; scarce for civilians
    media: 2, // Pravda; Izvestia; TASS; purely state propaganda
    financial: 1, // Gosbank monopoly; no private finance
    real_estate: 1, // state-allocated housing; kommunalka; no market
    healthcare: 1, // Semashko system; free universal; underfunded
    retail: 1, // state shops; queuing; black market
    automobiles: 0, // Moskvitch; GAZ Pobeda; elite Zil; negligible consumer auto
    technology: 0, // BESM-1 (1953); no commercial market
    entertainment: 0, // Bolshoi; socialist realism cinema; approved culture only
  },

  DD: {
    manufacturing: 28, // Carl Zeiss Jena; ORWO film; Leuna chemicals; precision machinery
    chemical_industries: 8, // Buna/IG Farben successor; synthetic rubber; plastics; priority sector
    extraction: 8, // Braunkohle (lignite) dominant; potash; Wismut uranium for USSR
    defense: 12, // KVP → NVA formation; Soviet garrison; June 17 uprising aftermath
    energy: 6, // lignite-fired power; Leuna gasification; DEWAG grid
    agriculture: 8, // collectivized LPG just beginning; traditional East Elbian farming
    construction: 6, // Stalinallee showcase; Stalinist socialist realism rebuild Berlin
    logistics: 4, // Deutsche Reichsbahn; Soviet garrison supply; canal network
    healthcare: 4, // East German healthcare investment; relatively well-funded
    automobiles: 2, // DKW/IFA precursor to Trabant; Wartburg development
    technology: 1, // Zeiss precision optics; VEB electronics early research
    retail: 2, // HO state shops; consumer goods chronic shortage
    media: 1, // SED Neues Deutschland; DEFA monopoly; state-controlled
    financial: 1, // Deutsche Notenbank; state monobank
    real_estate: 1,
    telecommunications: 1, // Deutsche Post; state-run
    entertainment: 1, // DEFA films; Berliner Ensemble (Brecht era); sport
  },

  // Soviet-bloc / Cominform states (1953 Stalinist-era command economies — the
  // Warsaw Pact was not signed until May 1955; bloc ties were Cominform/Comecon +
  // bilateral). YU is listed here for sector-weight convenience but was expelled
  // from Cominform in 1948 and pursued a non-aligned path (see YU block below).
  HU: {
    manufacturing: 22, // forced heavy industry shift; DIMÁVAG; Rákosi "iron and steel" obsession
    defense: 12, // ÁVH secret police; Soviet garrison; Honvédség; Stalinist militarism
    agriculture: 20, // forced collectivization; kulák persecution; ~50% of workforce
    extraction: 8, // bauxite (top-3 world); coal (Pécs, Tatabánya); manganese
    construction: 8, // Sztálinváros / Dunaújváros steelworks city; socialist housing
    chemical_industries: 5, // BorsodChem precursor; pharmaceutical early (Richter Gedeon)
    energy: 5, // coal-fired plants; Soviet oil imports; natural gas just starting
    logistics: 4, // MÁV rail; Danube river; Soviet supply lines
    healthcare: 4, // Soviet-style polyclinics; free but low quality
    retail: 2, // ÁFÉSZ state shops; chronic shortages
    media: 1, // Magyar Rádió; Szabad Nép newspaper; 100% state-controlled
    financial: 1, // Magyar Nemzeti Bank; state monobank
    real_estate: 1,
    telecommunications: 1,
    automobiles: 1, // Ikarus buses; Csepel trucks; no private cars
    entertainment: 2, // Operaház; Aranycsapat golden football team
    technology: 0,
  },

  PL: {
    extraction: 15, // Silesian coal — Poland's dominant export; copper Legnica starting
    manufacturing: 20, // Nowa Huta steel; FSO/FSM vehicles; heavy machinery; Gdańsk shipyards
    defense: 12, // LWP with Soviet advisors; high Stalinist priority; Bierut era
    agriculture: 22, // less collectivized than USSR; private farms survived; ~60% labor
    construction: 8, // socialist realist Warsaw MDM rebuild; Nowa Huta city
    chemical_industries: 5, // Azoty fertilizers; ZPT rubber; chemical plants
    energy: 5, // Silesian coal-fired electricity; power grid expansion
    logistics: 4, // PKP rail; Vistula river; Gdańsk/Gdynia ports
    healthcare: 4, // ZUS universal; Soviet-model polyclinics; improving
    retail: 1, // CPN state shops; barter economy; shortages
    media: 1, // Trybuna Ludu; Polskie Radio; strict censorship
    financial: 1, // NBP state monobank
    real_estate: 1,
    telecommunications: 1,
    automobiles: 1, // Warszawa (Soviet Pobeda copy); Syrena design starting
    entertainment: 1, // Polish film school emerging; theatre; sport
    technology: 0,
  },

  RO: {
    agriculture: 30, // collectivization just beginning; traditional peasant farming; ~65% labor
    extraction: 12, // Ploiești oil fields (significant producer); natural gas; coal
    manufacturing: 18, // oil refining; Reșița steel; Tractorul Brașov; textile mills
    defense: 10, // large Securitate apparatus; Soviet troops; Gheorghiu-Dej military
    energy: 6, // oil + coal power; hydroelectric dams starting
    construction: 6, // industrial building; Canal Dunăre–Marea Neagră (forced labor)
    chemical_industries: 4, // oil refining chemicals; fertilizer plants
    logistics: 4, // CFR rail; Danube river crucial transit
    healthcare: 3, // Soviet-model; uneven rural access
    retail: 2, // state trading; shortages
    media: 1, // Scînteia; Radio România; strict censorship
    financial: 1, // BNR state monobank
    real_estate: 1,
    telecommunications: 1,
    automobiles: 1, // trucks only; no passenger car industry yet
    entertainment: 1, // folk music; theatre; football
    technology: 0,
  },

  YU: {
    // Non-aligned communist state (Tito–Stalin split 1948): not Warsaw Pact, not
    // Cominform; US aid flowing; worker self-management replacing Soviet model.
    agriculture: 25, // less collectivized (Tito abandoned Soviet model 1953); peasants retained farms
    manufacturing: 20, // worker self-management factories; steel Zenica; textiles
    defense: 12, // independent from USSR since 1948; large army; Partisan tradition
    construction: 8, // Yugoslav road and rail expansion; industrial city building
    retail: 5, // more market-oriented than Bloc; workers' councils allow consumer goods
    extraction: 5, // copper Bor; lead/zinc; coal Bosnia; bauxite
    energy: 5, // coal + growing hydroelectric (Jablanica dam just built)
    chemical_industries: 4, // Pančevo petrochemicals starting; rubber
    logistics: 4, // JŽ rail; Adriatic ports Rijeka/Split; Danube
    healthcare: 3, // universal healthcare; better than Soviet Bloc average
    financial: 2, // workers' bank system forming; NBJ + commercial layer
    entertainment: 2, // Adriatic coast proto-tourism; Yugoslav film; sport
    media: 1, // relatively freer for Bloc; Borba; Yugoslav new wave
    real_estate: 1,
    telecommunications: 1,
    automobiles: 1, // Zastava/Crvena Zastava just starting 1953
    technology: 0,
  },

  CS: {
    manufacturing: 30, // most industrialized Eastern Bloc; Škoda, ČKD; prewar engineering tradition
    defense: 14, // key Soviet-bloc arms factory; uranium shipped to USSR; very high priority
    chemical_industries: 8, // Spolana, Chemopetrol; plastics; synthetic rubber
    extraction: 8, // Ostrava coal; Jáchymov uranium (Wismut equivalent); iron ore
    energy: 6, // coal-fired; Ostrava power plants; dense Czechoslovak grid
    agriculture: 12, // less agricultural than Eastern Bloc average; already industrialized 1938
    construction: 8, // socialist realist buildings; Gottwaldov (Zlín renamed); housing
    logistics: 5, // ČSD rail (dense network); Danube access Bratislava
    healthcare: 4, // strong pre-war tradition; universal coverage; Masaryk inheritance
    automobiles: 3, // Tatra T600; Škoda 1201; moderate production for Bloc
    retail: 1, // state trading only; lingering rationing
    media: 1, // Rudé Právo; Čs. rozhlas; Stalinist censorship
    financial: 1, // SBČS state monobank
    real_estate: 1,
    telecommunications: 1,
    technology: 1, // prewar scientific tradition; Masaryk-era universities
    entertainment: 1, // Czech/Slovak film; Národní divadlo; Sokol sport
  },

  BG: {
    agriculture: 40, // tobacco (world export), wine, vegetables, roses; ~65% labor force
    manufacturing: 15, // basic textiles, food processing; Kremikovtzi steel not yet
    defense: 10, // Chervenkov military buildup; large army for small country
    construction: 7, // socialist realist Sofia; Dimitrovgrad model city
    extraction: 5, // coal; copper Medet starting; lead/zinc
    energy: 5, // coal + Maritsa-East lignite plants starting
    logistics: 4, // BDŽ rail; Danube at Ruse; Black Sea ports
    healthcare: 3, // Soviet-model polyclinics; better than prewar
    chemical_industries: 3, // fertilizers; tobacco processing; basic chemicals
    retail: 2, // state trading; shortages
    media: 1, // Rabotnichesko Delo; Radio Sofia; Chervenkov censorship
    financial: 1, // BNB state monobank
    real_estate: 1,
    telecommunications: 1,
    automobiles: 1, // no domestic production; Soviet-supplied trucks
    entertainment: 1, // folk music; Kukeri traditions; football
    technology: 0,
  },

  // Ukraine (Ukrainian SSR), 1953. Two economies in one republic: the Donbas
  // coal field and the Dnieper metallurgical belt, restored at almost any cost
  // after the occupation, sitting on top of the union's largest grain and sugar
  // surplus. Consumer sectors barely exist - reconstruction had absolute
  // priority, and the 1946-47 famine is only six years past.
  UKR: {
    agriculture: 26, // black earth: wheat, sugar beet, sunflower; still ~55% of the workforce
    manufacturing: 18, // Zaporizhzhia and Dnipropetrovsk steel; Kharkiv machine building
    extraction: 14, // Donbas coal, Kryvyi Rih iron ore, Nikopol manganese
    energy: 7, // Dniprohes rebuilt 1950; coal-fired stations across the Donbas
    construction: 8, // Khreshchatyk and the ruined cities rebuilt from nothing
    defense: 7, // frontline military districts; Kharkiv tank plant lineage
    chemical_industries: 4, // coke chemistry; nitrogen fertiliser from Donbas gas
    logistics: 5, // the densest rail net in the union; Odesa and the Dnieper
    healthcare: 3, // Soviet polyclinic model; Kyiv and Kharkiv medical institutes
    retail: 2, // state trade only; rationing ended 1947 but supply stays thin
    media: 1, // Pravda Ukrainy; republican radio; full censorship
    automobiles: 1, // KrAZ/LAZ not yet; Soviet trucks supplied from Russia
    financial: 1, // Gosbank republican office; no autonomy
    real_estate: 1,
    telecommunications: 1,
    entertainment: 1, // Kyiv opera; Dovzhenko studio; folk ensembles
    technology: 0,
  },

  BY: {
    manufacturing: 20, // MAZ trucks; machine building; postwar Soviet investment massive
    agriculture: 25, // traditional base; recovering from WWII; potato, flax, dairy
    defense: 12, // frontline Soviet republic; large garrison; strategic position
    construction: 10, // massive reconstruction (~80% of Minsk destroyed); showcase Soviet rebuild
    logistics: 5, // key USSR transit hub; Brest–Terespol rail gateway to West
    extraction: 5, // peat (half of USSR peat reserves); potash Soligorsk; timber
    energy: 5, // peat-fired power stations; Moscow grid integration
    chemical_industries: 4, // potash fertilizers starting; defence chemicals
    healthcare: 4, // Soviet polyclinics; Minsk Medical Institute
    retail: 2, // state shops; reconstruction priority over consumer goods
    media: 1, // Zvezda; Belarusian Radio; censored
    financial: 1, // Gosbank branch; no autonomy
    real_estate: 1,
    telecommunications: 1,
    automobiles: 2, // MAZ/BELAZ early trucks; no private cars
    entertainment: 1, // Kupala National Theatre; folk music
    technology: 0,
  },

  BAL: {
    manufacturing: 22, // VEF radios Riga; RER railway cars; Estonian machinery; textiles
    extraction: 8, // Estonian oil shale (unique energy source); Lithuanian amber; timber
    defense: 10, // Soviet strategic Baltic coast; naval bases; Baltic Fleet garrison
    agriculture: 15, // dairy (Latvia/Lithuania famous); fishing (herring, sprats); less rural than USSR
    energy: 6, // Estonian oil shale electricity (unique); imported Soviet coal
    logistics: 6, // Riga/Tallinn/Klaipeda ports — crucial Soviet export transit; rail
    chemical_industries: 5, // VEF-related; pharmaceutical early (Grindeks); oil shale derivatives
    construction: 6, // Soviet reconstruction of wartime damage; Khrushchev-era housing
    healthcare: 5, // highest standard in Soviet Union; Tartu University medicine tradition
    retail: 3, // more developed than Soviet average; prewar bourgeois consumer culture
    media: 2, // Baltic-language press permitted (unique in USSR); local radio
    real_estate: 2, // prewar housing stock surviving; better than USSR average
    telecommunications: 2, // VEF radio manufacturing legacy; Ericsson-derived network
    financial: 1,
    automobiles: 1,
    entertainment: 3, // Laulupidu Song Festival tradition; opera; Baltic culture
    technology: 2, // VEF precision electronics; Tartu University science tradition
  },
};

/**
 * Runtime countryId -> 1953 national-bundle key. Two Soviet republics play under
 * a different CountryId than the key their authored bundle lives under: the USSR
 * plays as "RU" (bundle "SU") and Byelorussia as "BLR" (bundle "BY"). Ukraine
 * needs no alias: its bundle is authored under its own id "UKR". Without
 * these aliases their economies would seed an even sector split in 1953.
 */
const BUNDLE_KEY_ALIASES_1953: Record<string, string> = { RU: "SU", BLR: "BY" };
function bundleKey1953(countryId: CountryId | string): string {
  return BUNDLE_KEY_ALIASES_1953[countryId as string] ?? (countryId as string);
}

/**
 * Era-correct 1953 per-state / per-region sector specialties, keyed
 * "<runtimeCountryId>:<regionCode>". These are PARTIAL maps: they bend the
 * country-level 1953 baseline toward each region's real 1953 economy (see
 * `mergeStateOverride`). Authored for 1953 directly, so they carry the era's
 * character: peak manufacturing, coal/oil/ore extraction, cotton/grain/dairy
 * agriculture, Big-Three autos in the Midwest, shipbuilding and textiles in
 * Britain, heavy industry across the Urals and Donbass. No `technology` sector
 * (commercially ~0 in 1953) and only nascent `entertainment` (film, tourism).
 */
export const STATE_SECTOR_WEIGHT_OVERRIDES_1953: Record<string, SectorWeightMap> = {
  // United States (1950-census 48 states + DC; AK/HI still territories)
  "US:AL": { manufacturing: 16, agriculture: 16, extraction: 8 }, // Birmingham steel; cotton
  "US:AK": { extraction: 12, logistics: 6, agriculture: 4 }, // gold, fishing, canneries
  "US:AZ": { extraction: 20, agriculture: 12, defense: 8 }, // copper; cotton; airbases
  "US:AR": { agriculture: 22, extraction: 8 }, // cotton, rice; bauxite/oil
  "US:CA": { agriculture: 16, entertainment: 14, defense: 12, extraction: 8, energy: 6 }, // Central Valley; Hollywood; aerospace; LA oil
  "US:CO": { extraction: 14, agriculture: 12, defense: 8 }, // mining; ranching
  "US:CT": { defense: 16, manufacturing: 16, financial: 12 }, // submarines/aircraft; Hartford insurance
  "US:DE": { chemical_industries: 22, manufacturing: 12, financial: 8 }, // DuPont
  "US:DC": { financial: 12, media: 10, real_estate: 10 }, // federal district services
  "US:FL": { agriculture: 18, entertainment: 12, real_estate: 10, construction: 8 }, // citrus; tourism
  "US:GA": { agriculture: 16, manufacturing: 14, logistics: 8 }, // cotton; textiles
  "US:HI": { agriculture: 20, defense: 14, entertainment: 8 }, // sugar/pineapple; Pearl Harbor
  "US:ID": { agriculture: 20, extraction: 10, logistics: 8 }, // potatoes; silver; timber
  "US:IL": { manufacturing: 16, logistics: 12, agriculture: 12, financial: 10 }, // Chicago rail hub
  "US:IN": { manufacturing: 22, automobiles: 10, agriculture: 10 }, // Gary steel
  "US:IA": { agriculture: 26, manufacturing: 8 }, // corn, hogs
  "US:KS": { agriculture: 22, defense: 8, extraction: 6 }, // wheat; Wichita aircraft
  "US:KY": { agriculture: 16, extraction: 14 }, // tobacco; coal
  "US:LA": { extraction: 18, chemical_industries: 10, agriculture: 10 }, // oil/gas; sugar
  "US:ME": { manufacturing: 14, agriculture: 10, logistics: 8 }, // paper; fishing/timber
  "US:MD": { manufacturing: 16, defense: 12, financial: 8 }, // Bethlehem Steel; Navy
  "US:MA": { manufacturing: 16, financial: 12, healthcare: 10 }, // machinery; insurance; hospitals
  "US:MI": { automobiles: 26, manufacturing: 12 }, // Detroit Big Three
  "US:MN": { extraction: 16, agriculture: 14, manufacturing: 8 }, // Mesabi iron
  "US:MS": { agriculture: 24, manufacturing: 8 }, // cotton
  "US:MO": { manufacturing: 14, agriculture: 12, automobiles: 8, logistics: 8 }, // St Louis/KC
  "US:MT": { extraction: 18, agriculture: 14 }, // copper mining; ranching
  "US:NE": { agriculture: 26 }, // corn, cattle
  "US:NV": { extraction: 20, entertainment: 12 }, // mining; nascent gaming
  "US:NH": { manufacturing: 16, agriculture: 6 }, // textiles/machinery
  "US:NJ": { chemical_industries: 18, manufacturing: 14, financial: 8 }, // pharma
  "US:NM": { extraction: 14, defense: 12, agriculture: 8 }, // oil/potash/uranium; Los Alamos/Sandia
  "US:NY": { financial: 20, media: 12, manufacturing: 12, real_estate: 10 }, // Wall Street; publishing
  "US:NC": { manufacturing: 18, agriculture: 14 }, // textiles; tobacco
  "US:ND": { agriculture: 28 }, // wheat
  "US:OH": { manufacturing: 20, automobiles: 10, chemical_industries: 8 }, // steel; Akron rubber
  "US:OK": { extraction: 20, agriculture: 12 }, // oil
  "US:OR": { logistics: 12, agriculture: 12, manufacturing: 8 }, // timber/lumber
  "US:PA": { manufacturing: 22, extraction: 12, financial: 8 }, // US Steel; anthracite coal
  "US:RI": { manufacturing: 20, financial: 8 }, // textiles/jewelry
  "US:SC": { manufacturing: 18, agriculture: 14 }, // textiles
  "US:SD": { agriculture: 26, extraction: 6 }, // livestock/wheat; Homestake gold
  "US:TN": { manufacturing: 12, agriculture: 12, energy: 10, defense: 8 }, // TVA; Oak Ridge
  "US:TX": { extraction: 20, agriculture: 12, energy: 10 }, // oil; cattle/cotton
  "US:UT": { extraction: 16, defense: 8, agriculture: 8 }, // copper mining
  "US:VT": { agriculture: 18, manufacturing: 8, extraction: 8 }, // dairy; granite/marble
  "US:VA": { defense: 14, agriculture: 12, manufacturing: 10 }, // Norfolk Navy; tobacco
  "US:WA": { defense: 16, logistics: 10, agriculture: 10, energy: 8 }, // Boeing; ports; hydro
  "US:WV": { extraction: 22, chemical_industries: 8, energy: 6 }, // coal
  "US:WI": { agriculture: 18, manufacturing: 14 }, // dairy
  "US:WY": { extraction: 20, agriculture: 10, energy: 6 }, // coal/oil
  // United Kingdom (NUTS1 regions)
  "UK:LON": { financial: 22, media: 12, real_estate: 10, retail: 8 }, // the City; Fleet Street
  "UK:SEE": { manufacturing: 12, financial: 8, agriculture: 8, retail: 8 },
  "UK:SWE": { agriculture: 16, manufacturing: 8, logistics: 6 }, // farming; Plymouth naval
  "UK:EAE": { agriculture: 20, manufacturing: 6 }, // East Anglia arable
  "UK:EMI": { manufacturing: 20, extraction: 8 }, // hosiery; coal
  "UK:WMI": { manufacturing: 22, automobiles: 10 }, // Birmingham metal trades/cars
  "UK:YHU": { manufacturing: 20, extraction: 8 }, // Sheffield steel, Leeds wool; coal
  "UK:NWE": { manufacturing: 22, logistics: 8 }, // Lancashire cotton; Liverpool port
  "UK:NEE": { manufacturing: 18, extraction: 12 }, // Tyneside shipbuilding; coal
  "UK:SCO": { manufacturing: 16, extraction: 10, agriculture: 8 }, // Clyde shipbuilding; coal
  "UK:WAL": { extraction: 20, manufacturing: 14 }, // South Wales coal; Port Talbot steel
  "UK:NIR": { manufacturing: 16, agriculture: 12 }, // Belfast shipbuilding; linen/farming
  // Soviet Union (regions play under countryId "RU")
  "RU:CEN": { manufacturing: 22, defense: 12 }, // Moscow industrial core
  "RU:NWR": { manufacturing: 18, defense: 12 }, // Leningrad
  "RU:NOR": { extraction: 16, logistics: 8 }, // Kola nickel/apatite; timber
  "RU:CBE": { agriculture: 24 }, // Central Black Earth grain
  "RU:VOL": { manufacturing: 14, energy: 10, extraction: 8 }, // Volga industry/hydro; "Second Baku" oil
  "RU:NCA": { agriculture: 18, extraction: 10 }, // Kuban grain; Grozny oil
  "RU:URA": { manufacturing: 20, extraction: 14, defense: 10 }, // Urals metallurgy/heavy industry
  "RU:WSB": { extraction: 18, manufacturing: 12 }, // Kuzbass coal
  "RU:ESB": { extraction: 16, energy: 8, logistics: 6 }, // minerals; Siberian hydro
  "RU:FEA": { extraction: 14, logistics: 8, defense: 8 }, // gold, fishing; Pacific
  // Ukrainian SSR — the republic's own regions, now that Ukraine is a country
  // rather than an RU region. (The "RU:UKR"/"RU:BEL"/"RU:BLT" lines below are the
  // old single-region aggregates; they only apply where RU still seeds them.)
  "UKR:UKR_KYI": { manufacturing: 18, media: 8, healthcare: 6 }, // the republican capital and its machine works
  "UKR:UKR_WES": { agriculture: 30, extraction: 6 }, // Galicia/Volhynia: smallholding farms, Boryslav oil, timber
  "UKR:UKR_POD": { agriculture: 34 }, // sugar beet and grain; no plan showpiece at all
  "UKR:UKR_DON": { extraction: 30, manufacturing: 20, energy: 10 }, // Donbas coal, coke and steel
  "UKR:UKR_DNI": { manufacturing: 26, extraction: 16 }, // Zaporizhzhia/Dnipro steel; Kryvyi Rih ore
  "UKR:UKR_SOU": { agriculture: 20, logistics: 12, defense: 8 }, // Odesa port; Mykolaiv yards; steppe grain
  // Byelorussian SSR — rebuilt from near-total destruction; farm republic still.
  "BLR:BLR_MIN": { manufacturing: 20, construction: 12 }, // MAZ/MTZ; Minsk rebuilt from rubble
  "BLR:BLR_BRE": { agriculture: 28, logistics: 10 }, // the Brest transit gateway; Polesian farming
  "BLR:BLR_HOM": { agriculture: 24, extraction: 8 }, // peat and timber; Gomel machine works
  "BLR:BLR_GRO": { agriculture: 30 }, // the most agrarian and most Catholic oblast
  "BLR:BLR_MOG": { agriculture: 22, manufacturing: 12 },
  "BLR:BLR_VIT": { agriculture: 22, manufacturing: 12, energy: 6 }, // peat-fired power
  // Baltic republics — annexed 1940, still the best-supplied corner of the USSR.
  "BAL:BAL_EST": { extraction: 14, energy: 12, manufacturing: 18 }, // oil shale is the republic's whole energy story
  "BAL:BAL_LVA": { manufacturing: 24, logistics: 10, telecommunications: 4 }, // VEF Riga; the largest Baltic port
  "BAL:BAL_LTU": { agriculture: 26, manufacturing: 12, logistics: 6 }, // dairy and Klaipeda; least industrialised of the three
  "RU:UKR": { extraction: 16, manufacturing: 16, agriculture: 12 }, // Donbass coal; Dnipro steel; grain
  "RU:KAZ": { agriculture: 16, extraction: 14 }, // Virgin Lands; Karaganda coal
  "RU:TRA": { extraction: 20, agriculture: 8 }, // Baku oil
  "RU:CAS": { agriculture: 22, extraction: 6 }, // Central Asian cotton
  "RU:MOL": { agriculture: 26 }, // wine, fruit, grain
  "RU:BEL": { agriculture: 18, manufacturing: 10, logistics: 6 },
  "RU:BLT": { manufacturing: 14, logistics: 10, agriculture: 10 }, // Baltic ports
  // East Germany (DDR) — the six seeded eastern Länder (BEO/MV/BB/ST/SN/TH)
  "DD:BEO": { manufacturing: 14, media: 12, retail: 8 }, // East Berlin: administration, print, assembly
  "DD:MV": { agriculture: 22, logistics: 8 }, // Mecklenburg farming; Rostock port
  "DD:BB": { energy: 12, manufacturing: 12, agriculture: 8 }, // Lausitz lignite power; Eisenhuettenstadt steel
  "DD:ST": { chemical_industries: 20, manufacturing: 10 }, // Leuna/Buna/Bitterfeld chemicals; Magdeburg machine-building
  "DD:SN": { manufacturing: 20, automobiles: 8, extraction: 8 }, // Chemnitz machine-building; Zwickau autos; lignite
  "DD:TH": { manufacturing: 16, agriculture: 8 }, // Jena optics; Suhl workshops; Thuringian farming
  // West Germany (Bundesländer)
  "DE:NW": { manufacturing: 24, extraction: 12, chemical_industries: 8 }, // Ruhr coal, steel, heavy industry
  "DE:SL": { extraction: 16, manufacturing: 16 }, // Saarland coal & steel
  "DE:BW": { manufacturing: 20, automobiles: 12 }, // Stuttgart: Daimler, precision engineering
  "DE:BY": { manufacturing: 14, agriculture: 12, automobiles: 6 }, // Bavaria: farming + emerging industry
  "DE:HE": { financial: 16, chemical_industries: 12 }, // Frankfurt finance; Hoechst chemicals
  "DE:RP": { chemical_industries: 18, agriculture: 8 }, // BASF Ludwigshafen; Moselle wine
  "DE:NI": { manufacturing: 12, automobiles: 10, agriculture: 10, extraction: 8 }, // VW Wolfsburg; Salzgitter; gas
  "DE:SH": { agriculture: 16, logistics: 8 }, // farming; Kiel shipbuilding
  "DE:HH": { logistics: 18, manufacturing: 10, media: 8 }, // Hamburg port, shipyards, press
  "DE:BRE": { logistics: 16, manufacturing: 10 }, // Bremen port & shipbuilding
  "DE:BE": { manufacturing: 12, media: 10, retail: 8 }, // West Berlin
  // France
  "FR:FR_IDF": { financial: 16, manufacturing: 14, media: 10, automobiles: 6 }, // Paris: Renault/Citroën, banking, press
  "FR:FR_NOR": { extraction: 16, manufacturing: 16 }, // Nord: coal, textiles, steel
  "FR:FR_EST": { manufacturing: 18, extraction: 14 }, // Lorraine iron & steel; Alsace industry
  "FR:FR_OUE": { agriculture: 20, logistics: 8 }, // Brittany/Normandy farming; Atlantic ports
  "FR:FR_SOU": { agriculture: 14, energy: 8, extraction: 8 }, // Aquitaine: Lacq gas, farming, Landes timber
  "FR:FR_ARA": { manufacturing: 16, energy: 8 }, // Lyon industry; Alpine hydro
  "FR:FR_MED": { agriculture: 12, logistics: 10, entertainment: 8 }, // Marseille port; Riviera; farming
  "FR:FR_CEN": { agriculture: 22 }, // Beauce/Centre grain belt
  // Italy
  "IT:IT_NW": { manufacturing: 20, automobiles: 12 }, // Turin FIAT; Milan/Genoa industrial triangle
  "IT:IT_NE": { manufacturing: 12, agriculture: 14, energy: 8 }, // Po Valley farming; gas; Veneto textiles
  "IT:IT_TUS": { manufacturing: 12, extraction: 8, entertainment: 8 }, // Tuscan industry; iron/pyrite; tourism
  "IT:IT_LAZ": { financial: 12, media: 12, construction: 8 }, // Rome: government, Cinecittà, building
  "IT:IT_CAM": { manufacturing: 12, agriculture: 12, logistics: 8 }, // Naples industry; farming; port
  "IT:IT_SUD": { agriculture: 24 }, // the agrarian Mezzogiorno
  "IT:IT_SIC": { agriculture: 16, extraction: 12 }, // citrus, sulfur; Ragusa oil
  "IT:IT_SAR": { agriculture: 16, extraction: 10 }, // pastoral; Sulcis coal
  // Spain
  "ES:ES_MAD": { financial: 14, manufacturing: 10, media: 8 }, // Madrid: capital, services
  "ES:ES_CAT": { manufacturing: 22, retail: 6 }, // Barcelona: Spain's industrial heart, textiles
  "ES:ES_AND": { agriculture: 22, extraction: 8 }, // olives; Rio Tinto/Peñarroya mining
  "ES:ES_VAL": { agriculture: 20, logistics: 8 }, // citrus; Valencia port
  "ES:ES_PVB": { manufacturing: 22, extraction: 10 }, // Bilbao iron & steel, shipbuilding
  "ES:ES_GAL": { agriculture: 16, logistics: 8 }, // farming, fishing; Vigo
  "ES:ES_NOR": { extraction: 18, manufacturing: 14 }, // Asturias coal; northern steel
  "ES:ES_CEN": { agriculture: 22 }, // Castilian grain
  // Sweden
  "SE:SE_STH": { financial: 14, manufacturing: 10, media: 8 }, // Stockholm services
  "SE:SE_GOT": { manufacturing: 18, automobiles: 10, logistics: 8 }, // Göteborg: Volvo/SKF, port
  "SE:SE_SKA": { agriculture: 18, manufacturing: 8 }, // Skåne farming; Malmö industry
  "SE:SE_EAS": { manufacturing: 16, agriculture: 8 }, // Linköping (SAAB); farming
  "SE:SE_SML": { manufacturing: 16, extraction: 6 }, // small-industry & glass belt
  "SE:SE_VML": { manufacturing: 18, extraction: 14 }, // Bergslagen iron & steel
  "SE:SE_NOR": { extraction: 20, logistics: 8, energy: 8 }, // Kiruna iron; timber; hydro
  "SE:SE_UPP": { manufacturing: 14, extraction: 10, agriculture: 8 }, // mills & mining
  // Turkey
  "GR:GR_ATT": { manufacturing: 14, logistics: 12, financial: 8 }, // Athens–Piraeus: industry, port, banks
  "GR:GR_MAC": { agriculture: 16, manufacturing: 8, energy: 6 }, // Thessaloniki + tobacco plain; lignite
  "GR:GR_THE": { agriculture: 20, manufacturing: 4 }, // the wheat plain
  "GR:GR_EPC": { agriculture: 16, extraction: 6 }, // mountain smallholding; bauxite
  "GR:GR_PEL": { agriculture: 18, energy: 6 }, // currants/olives; Megalopolis lignite
  "GR:GR_ISL": { logistics: 16, agriculture: 10 }, // shipping islands; Crete farming
  "AT:AT_VIE": { manufacturing: 14, financial: 10, retail: 8 }, // the imperial capital: industry, banks, commerce
  "AT:AT_NOE": { agriculture: 18, energy: 8, manufacturing: 6 }, // eastern grain belt; Zistersdorf oil (USIA)
  "AT:AT_OOE": { manufacturing: 16, energy: 8, agriculture: 10 }, // VOEST Linz; Salzkammergut; Alpine hydro
  "AT:AT_STK": { manufacturing: 14, extraction: 10, agriculture: 10 }, // Erzberg iron; Mur-Mürz steel valley
  "AT:AT_TYR": { entertainment: 10, energy: 8, agriculture: 10 }, // Alpine tourism; hydro; mountain farming
  "FI:FI_UUS": { manufacturing: 12, financial: 8, logistics: 8 }, // Helsinki: engineering, banks, the port
  "FI:FI_SW": { agriculture: 14, manufacturing: 10, logistics: 8 }, // Turku shipyards (reparations ships); farm coast
  "FI:FI_HAM": { manufacturing: 16, extraction: 8, agriculture: 12 }, // Tampere textiles/metal; lake-district sawmills
  "FI:FI_EAS": { agriculture: 18, extraction: 14, energy: 6 }, // smallholder east; the forest heartland
  "FI:FI_OST": { agriculture: 18, extraction: 10, manufacturing: 8 }, // Bothnian farms; timber ports
  "FI:FI_LAP": { extraction: 16, energy: 10, agriculture: 8 }, // Lapland logging; Oulujoki/Kemijoki hydro
  "TR:TR_IST": { manufacturing: 16, logistics: 12, financial: 8 }, // Istanbul: industry, port, trade
  "TR:TR_ANK": { agriculture: 12, defense: 8, construction: 8 }, // capital; Anatolian farming
  "TR:TR_IZM": { agriculture: 16, logistics: 8, manufacturing: 6 }, // Aegean farming; Izmir port
  "TR:TR_MED": { agriculture: 20, logistics: 6 }, // Çukurova cotton; Mersin port
  "TR:TR_BLA": { extraction: 16, agriculture: 12 }, // Zonguldak coal; tea/hazelnut
  "TR:TR_ESA": { agriculture: 18, extraction: 8 }, // pastoral; Divriği iron
  "TR:TR_SEA": { agriculture: 16, extraction: 12 }, // cotton; Batman oil
  "TR:TR_CEN": { agriculture: 22 }, // Anatolian grain steppe
  // Japan
  "JP:KAN": { manufacturing: 24, financial: 12, media: 8 }, // Tokyo/Kanto: industrial + financial core
  "JP:KNS": { manufacturing: 22, retail: 6 }, // Osaka/Kinki: Hanshin industrial belt
  "JP:CHU": { manufacturing: 20, automobiles: 14 }, // Nagoya/Chubu: Toyota, machinery
  "JP:KYU": { manufacturing: 16, extraction: 12 }, // Kitakyushu steel; Miike/Chikuho coal
  "JP:TOH": { agriculture: 18, extraction: 6 }, // Tohoku rice; mining
  "JP:HOK": { agriculture: 16, extraction: 10, logistics: 6 }, // Hokkaido farming, coal, fishing
  "JP:CGK": { manufacturing: 12, extraction: 8, agriculture: 8 }, // Chugoku
  "JP:SHI": { agriculture: 16, manufacturing: 8 }, // Shikoku
  // China (macro-regions)
  "CN:DB": { manufacturing: 22, extraction: 12 }, // Dongbei: Anshan steel, heavy industry
  "CN:HB": { extraction: 14, agriculture: 12, manufacturing: 10 }, // Huabei: Shanxi coal; North China plain
  "CN:HD": { manufacturing: 16, agriculture: 12, logistics: 8 }, // Huadong: Shanghai industry, Yangtze delta
  "CN:HZ": { agriculture: 20, extraction: 8 }, // Huazhong: central grain; Henan coal
  "CN:HN": { agriculture: 18, manufacturing: 8 }, // Huanan: Guangdong/Pearl delta
  "CN:XN": { agriculture: 16, extraction: 12 }, // Xinan: Sichuan basin; SW minerals
  "CN:XB": { extraction: 16, agriculture: 12 }, // Xibei: Xinjiang oil/coal; NW pastoral
  // Brazil
  "BR:SUDESTE": { manufacturing: 20, extraction: 10, financial: 10 }, // São Paulo/Minas: industrial core, iron
  "BR:SUL": { agriculture: 18, manufacturing: 10 }, // Rio Grande do Sul: farming + industry
  "BR:NORDESTE": { agriculture: 20, extraction: 6 }, // sugar/cotton; offshore oil
  "BR:NORTE": { extraction: 16, agriculture: 8 }, // Amazon: Carajás iron, timber
  "BR:CENTRO_OESTE": { agriculture: 24 }, // cerrado ranching & grain
  // Ireland
  "IE:DUB": { financial: 12, manufacturing: 10, retail: 8 }, // Dublin services
  "IE:KIL": { agriculture: 20 }, // southeast tillage
  "IE:MID": { agriculture: 20, energy: 6 }, // Midlands farming; peat/turf power
  "IE:WEX": { agriculture: 22 }, // Wexford tillage
  "IE:LIM": { agriculture: 16, manufacturing: 8, energy: 6 }, // Limerick; Shannon/Ardnacrusha hydro
  "IE:COR": { agriculture: 14, manufacturing: 10, logistics: 8 }, // Cork harbour, food processing
  "IE:GAL": { agriculture: 18, logistics: 6 }, // Galway/west farming, fishing
  "IE:DON": { agriculture: 18 }, // Donegal farming, fishing
  // Nigeria (1953 — pre-oil; petroleum production began 1958)
  "NG:SOUTH_SOUTH": { agriculture: 18, extraction: 8, logistics: 6 }, // Niger Delta palm produce; (oil post-1958)
  "NG:SOUTH_WEST": { agriculture: 18, logistics: 8, retail: 6 }, // Yorubaland cocoa; Lagos trade
  "NG:SOUTH_EAST": { agriculture: 20, extraction: 6 }, // palm produce; Enugu coal
  "NG:NORTH_CENTRAL": { agriculture: 20, extraction: 6 }, // Jos tin/columbite; farming
  "NG:NORTH_WEST": { agriculture: 24 }, // groundnuts, cotton
  "NG:NORTH_EAST": { agriculture: 24 }, // groundnuts, livestock
};

/** Raw (un-normalized) 1953 country sector map, with RU aliased to SU. */
export function getCountrySectorRaw1953(countryId: CountryId): SectorWeightMap {
  return COUNTRY_SECTOR_WEIGHTS_1953[bundleKey1953(countryId)] ?? {};
}

/**
 * Returns the 1953 country-level sector weight map.
 * Used by `getStateSectorWeights` when the active preset is `1953-default`.
 */
export function getCountrySectorWeights1953(countryId: CountryId): Record<CorporationType, number> {
  const raw = COUNTRY_SECTOR_WEIGHTS_1953[bundleKey1953(countryId)] ?? {};
  const entries = CORPORATION_TYPES.map((t) => [t, raw[t] ?? 0] as const);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) {
    const even = 1 / CORPORATION_TYPES.length;
    return Object.fromEntries(CORPORATION_TYPES.map((t) => [t, even])) as Record<
      CorporationType,
      number
    >;
  }
  return Object.fromEntries(entries.map(([t, v]) => [t, v / total])) as Record<
    CorporationType,
    number
  >;
}
