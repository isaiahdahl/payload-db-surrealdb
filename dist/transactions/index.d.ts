import type { BeginTransaction, CommitTransaction, RollbackTransaction } from 'payload';
import type { SurrealAdapter } from '../index.js';
export type SurrealTransactionSession = {
    createdAt: number;
    statements: string[];
};
export declare const getTransactionID: (req?: {
    transactionID?: Promise<number | string | null> | number | string | null;
}) => Promise<null | string>;
export declare const getTransaction: (adapter: SurrealAdapter, req?: {
    transactionID?: Promise<number | string | null> | number | string | null;
}) => Promise<null | SurrealTransactionSession>;
export declare const queueTransactionStatement: (adapter: SurrealAdapter, req: {
    transactionID?: Promise<number | string | null> | number | string | null;
} | undefined, statement: string) => Promise<boolean>;
export declare const beginTransaction: BeginTransaction;
export declare const commitTransaction: CommitTransaction;
export declare const rollbackTransaction: RollbackTransaction;
