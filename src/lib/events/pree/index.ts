/**
 * PREE handler barrel — side-effect imports register handlers at startup.
 */
import "./handlers/lotteryWin";
import "./handlers/stafferScandal";
import "./handlers/campaignViral";
import "./handlers/corruptDonor";
import "./handlers/ceoWhistleblower";
import "./handlers/taxAudit";
import "./handlers/oldFriendVenture";
import "./handlers/memoirOffer";
import "./handlers/townHallAmbush";
import "./handlers/endorsementDilemma";
import "./handlers/debateGaffe";
import "./handlers/productRecall";
import "./handlers/insiderTip";
import "./handlers/charityGala";
import "./handlers/localInterview";
import "./handlers/speakingFee";
import "./handlers/juryDuty";
import "./handlers/ribbonCutting";
import "./handlers/constituentLetters";
import "./handlers/partyFundraiser";
import "./handlers/earningsCall";
import "./handlers/employeeMorale";
import "./handlers/vendorRenewal";
import "./handlers/canvassWeekend";
import "./handlers/yardSignDrive";
import "./handlers/minorityStrategyPressure";
import "./handlers/minorityExpansionDemand";
import "./handlers/minorityExtractionObjection";
import "./handlers/boardroomUltimatum";
// Everyday (20) and easter egg (4) global events.
import "./handlers/everydayEvents";
import "./handlers/everydayEvents2";
import "./handlers/easterEggs";
// Country-scoped events (flagship 4: US/UK/JP/DE) — each module registers six handlers.
import "./handlers/usEvents";
import "./handlers/ukEvents";
import "./handlers/jpEvents";
import "./handlers/deEvents";
// World Events v1 Phase 0 — true country-scope events (deciderRole: executive).
import "../worldEvents/handlers/sportsVictory";
// World Events v1 Phase 1 — scheduled flavor events.
import "../worldEvents/handlers/papalVisit";
import "../worldEvents/handlers/royalEvent";
import "../worldEvents/handlers/ukBudgetDay";
import "../worldEvents/handlers/ukNhsWinter";
import "../worldEvents/handlers/ukBbcCharter";
// World Events v1 Phase 2 — executive decision events (real multi-option decisions).
import "../worldEvents/handlers/stateVisit";
import "../worldEvents/handlers/intlSummit";
import "../worldEvents/handlers/scientificBreakthrough";
// World Events v1 Phase 3 — Olympics/worlds-fair simple flavor events (one
// deterministically-selected host country, no bidding).
import "../worldEvents/handlers/olympics";
import "../worldEvents/handlers/worldsFair";
// Era-gated content: period counterparts (4), decade events (20), era country
// packs (US/UK/RU/DD, 6 each), and Cold War world events (5 in one module).
import "./handlers/eraCounterpartEvents";
import "./handlers/decadeEvents";
import "./handlers/usEraEvents";
import "./handlers/ukEraEvents";
import "./handlers/ruEraEvents";
import "./handlers/ddEraEvents";
import "../worldEvents/handlers/coldWarWorldEvents";
// High-tension society events (4), gated on the global tension reading.
import "../worldEvents/handlers/highTensionEvents";
// Broadcast events (5) — shared historic moments offered to everyone at once.
import "./handlers/broadcastEvents";
