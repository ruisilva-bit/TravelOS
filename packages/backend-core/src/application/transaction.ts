export const TRANSACTION_NESTING_POLICY = "REJECT" as const;

export interface TransactionContext {
  readonly transactionContextKind: "travelos.transaction-context";
}

export type TransactionWork<Result> = (context: TransactionContext) => Promise<Result>;

export interface TransactionPort {
  runInTransaction<Result>(work: TransactionWork<Result>): Promise<Result>;
}

export class NestedTransactionNotSupportedError extends Error {
  readonly code = "NESTED_TRANSACTION_NOT_SUPPORTED";

  constructor() {
    super("Nested transactions are not supported by the TravelOS transaction port");
    this.name = "NestedTransactionNotSupportedError";
  }
}
