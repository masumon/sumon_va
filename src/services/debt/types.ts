// Domain types for the Personal Debt & Receivable module. All amounts are integer paisa.
import type { Paisa } from './money';

export type Direction = 'DEBT' | 'RECEIVABLE';

export type InterestType = 'NONE' | 'FLAT_TOTAL' | 'SIMPLE' | 'COMPOUND' | 'MONTHLY_FLAT';
export type RatePeriod = 'YEAR' | 'MONTH' | 'WEEK' | 'DAY';

/**
 * What interest is charged on. ORIGINAL keeps charging on the full principal however
 * much has been repaid — how an informal "X% per month" loan actually works here, and
 * what every account created before this option existed assumed. REDUCING charges on
 * the balance still outstanding, recomputed after each repayment, like a bank loan.
 */
export type InterestBasis = 'ORIGINAL' | 'REDUCING';

export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type AccountStatus =
  | 'ACTIVE'
  | 'PARTIAL'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'SETTLED'
  | 'WRITTEN_OFF';

export type TxnKind =
  | 'NEW_DEBT'
  | 'NEW_RECEIVABLE'
  | 'PAYMENT'
  | 'RECEIPT'
  | 'ADJUSTMENT'
  | 'REVERSAL'
  | 'SETTLEMENT'
  | 'WRITE_OFF'
  | 'INTEREST_ACCRUAL';

export type AllocationRole = 'INSTALLMENT' | 'PRINCIPAL' | 'ADVANCE' | 'INTEREST';

export type PromiseStatus = 'OPEN' | 'FULFILLED' | 'BROKEN';

export type TargetPeriodType = 'MONTH' | 'YEAR';
export type TargetKind = 'REPAYMENT' | 'REDUCTION_PCT' | 'CLOSE_COUNT';

export type Strategy = 'SNOWBALL' | 'AVALANCHE' | 'CUSTOM';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// Built-in keys; the user can add custom strings alongside these (stored in dr_settings).
export const DEFAULT_PAYMENT_METHODS = ['CASH', 'BANK', 'BKASH', 'NAGAD', 'ROCKET', 'CARD', 'CHEQUE', 'OTHER'] as const;
export const DEFAULT_PAYMENT_SOURCES = [
  'SALARY', 'FREELANCE', 'BUSINESS', 'SAVINGS', 'CASH', 'BANK_BALANCE',
  'FAMILY', 'FRIEND', 'BORROWED', 'BANK_LOAN', 'CREDIT', 'OTHER',
] as const;
export const DEFAULT_PURPOSES = [
  'EMERGENCY', 'FAMILY', 'EDUCATION', 'MEDICAL', 'HOUSE', 'VEHICLE',
  'PERSONAL', 'BUSINESS', 'OLD_DEBT', 'DAILY_EXPENSE', 'OTHER',
] as const;

// ── stored entities (as returned by repositories, camelCased) ───────────────────

export interface Person {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  relationship: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Account {
  id: string;
  direction: Direction;
  personId: string;
  title: string | null;
  principalPaisa: Paisa;
  openedDate: string | null;
  openedDateText: string | null;
  interestType: InterestType;
  interestRateBps: number | null;
  interestPeriod: RatePeriod | null;
  compoundPeriod: RatePeriod | null;
  interestBasis: InterestBasis;
  manualTotalPayablePaisa: Paisa | null;
  firstDueDate: string | null;
  finalDueDate: string | null;
  purpose: string | null;
  priority: Priority;
  priorityRank: number | null;
  status: AccountStatus;
  settledPaisa: Paisa | null;
  /** The day this account stopped owing anything. Interest never accrues past it. */
  closedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Installment {
  id: string;
  accountId: string;
  seq: number;
  dueDate: string | null;
  amountPaisa: Paisa;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  kind: TxnKind;
  accountId: string;
  personId: string;
  amountPaisa: Paisa;
  adjSign: 1 | -1 | null;
  txnDate: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  reversesTxnId: string | null;
  reversed: boolean;
  createdAt: string;
  deletedAt: string | null;
}

export interface Allocation {
  id: string;
  transactionId: string;
  installmentId: string | null;
  amountPaisa: Paisa;
  role: AllocationRole;
}

export interface TransactionSource {
  id: string;
  transactionId: string;
  sourceKey: string;
  amountPaisa: Paisa;
  linkedAccountId: string | null;
  note: string | null;
}

export interface PromiseToPay {
  id: string;
  accountId: string;
  amountPaisa: Paisa;
  promisedDate: string;
  followUpDate: string | null;
  status: PromiseStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Target {
  id: string;
  periodType: TargetPeriodType;
  periodKey: string;
  kind: TargetKind;
  targetValue: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── create/update inputs ───────────────────────────────────────────────────────

export interface CreatePersonInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  relationship?: string | null;
  notes?: string | null;
}

export interface InstallmentPlanInput {
  seq: number;
  dueDate?: string | null;
  amountPaisa: Paisa;
  note?: string | null;
}

export interface CreateAccountInput {
  direction: Direction;
  personId: string;
  title?: string | null;
  principalPaisa: Paisa;
  openedDate?: string | null;
  openedDateText?: string | null;
  interestType?: InterestType;
  interestRateBps?: number | null;
  interestPeriod?: RatePeriod | null;
  compoundPeriod?: RatePeriod | null;
  interestBasis?: InterestBasis;
  manualTotalPayablePaisa?: Paisa | null;
  firstDueDate?: string | null;
  finalDueDate?: string | null;
  purpose?: string | null;
  priority?: Priority;
  priorityRank?: number | null;
  notes?: string | null;
  /** Optional installment schedule created together with the account. */
  installments?: InstallmentPlanInput[];
}

export interface SourceLineInput {
  sourceKey: string;
  amountPaisa: Paisa;
  /** For sourceKey === 'BORROWED': an existing debt account to top up, or a new one to open. */
  linkedAccountId?: string | null;
  newBorrowAccount?: { personId: string; title?: string | null } | null;
  note?: string | null;
}

export interface AllocationLineInput {
  installmentId?: string | null;
  amountPaisa: Paisa;
  role?: AllocationRole;
}

export interface RecordPaymentInput {
  accountId: string;
  amountPaisa: Paisa;
  txnDate: string;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  /** How the payment maps onto installments / principal / advance. Auto-filled when omitted. */
  allocations?: AllocationLineInput[];
  /**
   * The instalment the user pointed at. Allocation starts there and carries on in due-date
   * order, so anything above that instalment's balance still lands somewhere real.
   */
  startInstallmentId?: string | null;
  /** Where the money came from. Must sum to amountPaisa when provided. */
  sources?: SourceLineInput[];
}

export type RecordReceiptInput = Omit<RecordPaymentInput, 'sources'>;

// ── derived (never stored) ─────────────────────────────────────────────────────

export interface AccountBalance {
  accountId: string;
  direction: Direction;
  /** principal (+ accrued interest for interest-bearing accounts) */
  totalPayablePaisa: Paisa;
  principalPaisa: Paisa;
  accruedInterestPaisa: Paisa;
  paidPaisa: Paisa;
  paidPrincipalPaisa: Paisa;
  paidInterestPaisa: Paisa;
  remainingPaisa: Paisa;
  advancePaisa: Paisa;
  adjustmentPaisa: Paisa;
  progressPct: number;
  status: AccountStatus;
  nextDueDate: string | null;
  nextDuePaisa: Paisa;
  overduePaisa: Paisa;
  overdueDays: number;
  installmentsPaidCount: number;
  installmentsTotalCount: number;
}
