import type { BeginTransaction, CommitTransaction, RollbackTransaction } from 'payload';
import type { SurrealAdapter } from '../index.js';
export type SurrealTransactionSession = {
    createdAt: number;
    deletedIDs?: Record<string, Array<number | string>>;
    docs?: Record<string, Record<string, unknown>[]>;
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
export declare const addTransactionDoc: (adapter: SurrealAdapter, req: {
    transactionID?: Promise<number | string | null> | number | string | null;
} | undefined, collection: string, doc: Record<string, unknown>) => Promise<void>;
export declare const addTransactionDeletedDocs: (adapter: SurrealAdapter, req: {
    transactionID?: Promise<number | string | null> | number | string | null;
} | undefined, collection: string, docs: Record<string, unknown>[]) => Promise<void>;
export declare const getTransactionDeletedIDs: (adapter: SurrealAdapter, req: {
    transactionID?: Promise<number | string | null> | number | string | null;
} | undefined, collection: string) => Promise<Array<number | string>>;
export declare const getTransactionDocs: (adapter: SurrealAdapter, req: {
    transactionID?: Promise<number | string | null> | number | string | null;
} | undefined, collection: string) => Promise<Record<string, unknown>[]>;
export declare const beginTransaction: BeginTransaction;
export declare const commitTransaction: CommitTransaction;
export declare const rollbackTransaction: RollbackTransaction;
