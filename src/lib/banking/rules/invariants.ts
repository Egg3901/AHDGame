/**
 * The banking invariant catalog, as code.
 *
 * Private banking's failures never showed up as exceptions. Every write was
 * correct against its own local arithmetic, and the disease lived between two
 * correct writes: a deposit book credited back to the money supply while the
 * cash stayed in the vault, interest credited with nothing debited, a player
 * balance "held" by a bank that never received it. A catalog that lives in a
 * design document cannot catch that. One that runs can.
 *
 * Each invariant below is a pure predicate over plain data. Nothing here knows
 * about the database, the clock, or a request. Turn phases, the settlement
 * journal, the simulation harness and the tests all feed it the same shapes
 * and get the same verdicts, which is the point: there is one definition of
 * "the books balance", not one per caller.
 *
 * Sign convention, shared with the money-movement primitive: a debit takes
 * from a balance, a credit gives to one, a mint is the outside world's side of
 * a credit and a burn the outside world's side of a debit. `mint X + credit X`
 * nets to zero and so does `debit X + burn X`, so a closed system with two
 * explicit doors in it can be checked with one sum.
 */

export type ValueLegKind = "debit" | "credit" | "mint" | "burn";

/** One side of a value movement, reduced to what the invariants need. */
export interface ValueLeg {
  kind: ValueLegKind;
  /** Positive magnitude. The sign is the kind's job, never the caller's. */
  amount: number;
  /** Opaque balance identity, e.g. `corporations:<hex>:bankCharter.cashReserves`. */
  account?: string;
}

/** Below this, a net is zero. Matches the settlement primitive exactly. */
export const NET_TOLERANCE = 1e-6;

export function legSign(kind: ValueLegKind): number {
  return kind === "debit" || kind === "mint" ? -1 : 1;
}

/** Legs must net to zero: every credit is somebody's debit, mint, or burn. */
export function legsNet(legs: readonly Pick<ValueLeg, "kind" | "amount">[]): number {
  return legs.reduce((sum, leg) => sum + legSign(leg.kind) * Math.max(0, leg.amount), 0);
}

export type BankingInvariantId =
  | "balanced_transfer"
  | "guarded_debit"
  | "one_authoritative_balance"
  | "bank_accounting_identity"
  | "exactly_once"
  | "jurisdiction_ownership";

export interface BankingInvariantSpec {
  id: BankingInvariantId;
  statement: string;
  /** Which module is responsible for keeping it true. */
  owner: "settlement" | "accounts" | "rules" | "governance";
}

/**
 * The catalog. The order is the order a reviewer should think about them in:
 * a movement balances, a movement cannot overdraw, a balance has one owner, a
 * bank's books add up, a movement lands once, a rate has one author.
 */
export const BANKING_INVARIANTS: readonly BankingInvariantSpec[] = [
  {
    id: "balanced_transfer",
    statement:
      "Every value transfer nets to zero across its legs. Money entering or leaving the world is an explicit mint or burn leg, never an arithmetic remainder.",
    owner: "settlement",
  },
  {
    id: "guarded_debit",
    statement:
      "No debit applies unless the balance it takes from covers it. A balance the game guards can never go negative through a settlement.",
    owner: "settlement",
  },
  {
    id: "one_authoritative_balance",
    statement:
      "Each owner holds exactly one authoritative savings balance per currency. Every other copy is a projection that must equal it.",
    owner: "accounts",
  },
  {
    id: "bank_accounting_identity",
    statement:
      "For every bank, assets equal liabilities plus equity: cash plus loans equals deposits owed plus borrowings plus the owner's claim.",
    owner: "rules",
  },
  {
    id: "exactly_once",
    statement:
      "A settlement key applies at most once. A replay returns the recorded result and moves nothing.",
    owner: "settlement",
  },
  {
    id: "jurisdiction_ownership",
    statement:
      "Each currency area has exactly one policy institution, and only that institution changes its rate, board, or meeting state.",
    owner: "governance",
  },
];

export interface InvariantViolation {
  invariant: BankingInvariantId;
  /** What broke, in words an operator can act on. */
  detail: string;
  /** The account, bank, key or currency involved, when there is one. */
  subject?: string;
}

// ── balanced_transfer ────────────────────────────────────────────────────────

export function checkBalancedTransfer(
  legs: readonly ValueLeg[],
  subject?: string
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  legs.forEach((leg, i) => {
    if (!Number.isFinite(leg.amount) || leg.amount < 0) {
      out.push({
        invariant: "balanced_transfer",
        detail: `leg ${i} carries a non-finite or negative amount (${String(leg.amount)})`,
        subject,
      });
    }
  });
  const net = legsNet(legs);
  if (Math.abs(net) > NET_TOLERANCE) {
    out.push({
      invariant: "balanced_transfer",
      detail: `legs net to ${net}, not zero`,
      subject,
    });
  }
  return out;
}

// ── guarded_debit ────────────────────────────────────────────────────────────

/**
 * Debits are checked cumulatively per account: two debits against the same
 * balance in one transition must be covered together, which is how the
 * settlement primitive applies them (debits first, in order).
 */
export function checkGuardedDebits(
  balances: Readonly<Record<string, number>>,
  legs: readonly ValueLeg[],
  subject?: string
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const running = new Map<string, number>();
  for (const leg of legs) {
    if (leg.kind !== "debit") continue;
    const account = leg.account;
    if (!account) {
      out.push({
        invariant: "guarded_debit",
        detail: "a debit leg names no account",
        subject,
      });
      continue;
    }
    const known = balances[account];
    if (typeof known !== "number" || !Number.isFinite(known)) {
      out.push({
        invariant: "guarded_debit",
        detail: `debit against ${account}, which has no known balance`,
        subject: subject ?? account,
      });
      continue;
    }
    const before = running.get(account) ?? known;
    const after = before - Math.max(0, leg.amount);
    if (after < -NET_TOLERANCE) {
      out.push({
        invariant: "guarded_debit",
        detail: `debit of ${leg.amount} against ${account} would leave ${after}`,
        subject: subject ?? account,
      });
    }
    running.set(account, after);
  }
  return out;
}

// ── one_authoritative_balance ────────────────────────────────────────────────

export interface AuthoritativeBalance {
  ownerId: string;
  currency: string;
  balance: number;
}

/**
 * `projections` are the compatibility copies (today: the embedded character
 * savings field). Every projection must have exactly one authoritative account
 * behind it and equal it; every account may have at most one projection.
 */
export function checkOneAuthoritativeBalance(
  accounts: readonly AuthoritativeBalance[],
  projections: readonly AuthoritativeBalance[] = [],
  tolerance = NET_TOLERANCE
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const keyOf = (row: AuthoritativeBalance) => `${row.ownerId}:${row.currency}`;

  const byKey = new Map<string, AuthoritativeBalance[]>();
  for (const account of accounts) {
    const key = keyOf(account);
    byKey.set(key, [...(byKey.get(key) ?? []), account]);
  }
  for (const [key, rows] of byKey) {
    if (rows.length > 1) {
      out.push({
        invariant: "one_authoritative_balance",
        detail: `${rows.length} authoritative accounts for one owner and currency`,
        subject: key,
      });
    }
  }

  const seenProjection = new Set<string>();
  for (const projection of projections) {
    const key = keyOf(projection);
    if (seenProjection.has(key)) {
      out.push({
        invariant: "one_authoritative_balance",
        detail: "more than one projection for one owner and currency",
        subject: key,
      });
      continue;
    }
    seenProjection.add(key);
    const rows = byKey.get(key);
    if (!rows || rows.length === 0) {
      out.push({
        invariant: "one_authoritative_balance",
        detail: `projection of ${projection.balance} has no authoritative account behind it`,
        subject: key,
      });
      continue;
    }
    const authoritative = rows[0].balance;
    if (Math.abs(authoritative - projection.balance) > tolerance) {
      out.push({
        invariant: "one_authoritative_balance",
        detail: `projection ${projection.balance} disagrees with the account ${authoritative}`,
        subject: key,
      });
    }
  }
  return out;
}

// ── bank_accounting_identity ─────────────────────────────────────────────────

export interface BankBooks {
  bankId: string;
  cash: number;
  loans: number;
  /** Deposits the bank owes as cash-backed liabilities. */
  deposits: number;
  borrowings: number;
  /** The owner's claim as the bank reports it. */
  equity: number;
}

export function checkBankAccountingIdentity(
  books: BankBooks,
  tolerance = NET_TOLERANCE
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const fields: (keyof Omit<BankBooks, "bankId">)[] = [
    "cash",
    "loans",
    "deposits",
    "borrowings",
    "equity",
  ];
  for (const field of fields) {
    const value = books[field];
    if (!Number.isFinite(value)) {
      out.push({
        invariant: "bank_accounting_identity",
        detail: `${field} is not a finite number`,
        subject: books.bankId,
      });
    }
  }
  if (out.length > 0) return out;
  for (const field of ["cash", "loans", "deposits", "borrowings"] as const) {
    if (books[field] < -tolerance) {
      out.push({
        invariant: "bank_accounting_identity",
        detail: `${field} is negative (${books[field]})`,
        subject: books.bankId,
      });
    }
  }
  const assets = books.cash + books.loans;
  const claims = books.deposits + books.borrowings + books.equity;
  if (Math.abs(assets - claims) > tolerance) {
    out.push({
      invariant: "bank_accounting_identity",
      detail: `assets ${assets} do not equal liabilities plus equity ${claims}`,
      subject: books.bankId,
    });
  }
  return out;
}

// ── exactly_once ─────────────────────────────────────────────────────────────

export type SettlementOutcome = "applied" | "replayed" | "rejected" | "partial";

export interface SettlementApplication {
  key: string;
  outcome: SettlementOutcome;
}

/**
 * Across a history of settlement attempts, a key may be `applied` at most once
 * and, once applied, every later attempt must be a replay.
 */
export function checkExactlyOnce(history: readonly SettlementApplication[]): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const applied = new Map<string, number>();
  for (const row of history) {
    const count = applied.get(row.key) ?? 0;
    if (row.outcome === "applied") {
      if (count > 0) {
        out.push({
          invariant: "exactly_once",
          detail: `key applied ${count + 1} times`,
          subject: row.key,
        });
      }
      applied.set(row.key, count + 1);
    } else if (row.outcome === "partial" && count > 0) {
      out.push({
        invariant: "exactly_once",
        detail: "key moved money again after it had already applied",
        subject: row.key,
      });
    }
  }
  return out;
}

// ── jurisdiction_ownership ───────────────────────────────────────────────────

export interface JurisdictionClaim {
  currency: string;
  institutionId: string;
}

export interface PolicyMutation {
  currency: string;
  institutionId: string;
  /** What was changed, for the report. */
  field: "rate" | "board" | "meeting" | "history";
}

export function checkJurisdictionOwnership(
  claims: readonly JurisdictionClaim[],
  mutations: readonly PolicyMutation[] = []
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const ownerByCurrency = new Map<string, Set<string>>();
  for (const claim of claims) {
    const set = ownerByCurrency.get(claim.currency) ?? new Set<string>();
    set.add(claim.institutionId);
    ownerByCurrency.set(claim.currency, set);
  }
  for (const [currency, owners] of ownerByCurrency) {
    if (owners.size !== 1) {
      out.push({
        invariant: "jurisdiction_ownership",
        detail: `${owners.size} institutions claim the currency: ${[...owners].join(", ")}`,
        subject: currency,
      });
    }
  }
  for (const mutation of mutations) {
    const owners = ownerByCurrency.get(mutation.currency);
    if (!owners) {
      out.push({
        invariant: "jurisdiction_ownership",
        detail: `${mutation.institutionId} changed the ${mutation.field} of a currency nobody owns`,
        subject: mutation.currency,
      });
      continue;
    }
    if (!owners.has(mutation.institutionId)) {
      out.push({
        invariant: "jurisdiction_ownership",
        detail: `${mutation.institutionId} changed the ${mutation.field} owned by ${[...owners].join(", ")}`,
        subject: mutation.currency,
      });
    }
  }
  return out;
}

// ── whole-world evaluation ───────────────────────────────────────────────────

/**
 * Everything the catalog can be asked about at once. Every field is optional
 * so a caller that only has a transition to check is not asked to invent a
 * jurisdiction table.
 */
export interface BankingInvariantWorld {
  transfers?: readonly { subject?: string; legs: readonly ValueLeg[] }[];
  balances?: Readonly<Record<string, number>>;
  accounts?: readonly AuthoritativeBalance[];
  projections?: readonly AuthoritativeBalance[];
  banks?: readonly BankBooks[];
  settlements?: readonly SettlementApplication[];
  jurisdictions?: readonly JurisdictionClaim[];
  policyMutations?: readonly PolicyMutation[];
}

export function evaluateBankingInvariants(world: BankingInvariantWorld): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const transfer of world.transfers ?? []) {
    out.push(...checkBalancedTransfer(transfer.legs, transfer.subject));
    if (world.balances) {
      out.push(...checkGuardedDebits(world.balances, transfer.legs, transfer.subject));
    }
  }
  if (world.accounts) {
    out.push(...checkOneAuthoritativeBalance(world.accounts, world.projections ?? []));
  }
  for (const books of world.banks ?? []) {
    out.push(...checkBankAccountingIdentity(books));
  }
  if (world.settlements) out.push(...checkExactlyOnce(world.settlements));
  if (world.jurisdictions) {
    out.push(...checkJurisdictionOwnership(world.jurisdictions, world.policyMutations ?? []));
  }
  return out;
}
