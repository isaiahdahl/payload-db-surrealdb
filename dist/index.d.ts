import type { BaseDatabaseAdapter, DatabaseAdapterObj } from 'payload';
import type { SurrealClient } from './client.js';
export type { MigrateDownArgs, MigrateUpArgs } from './migrations.js';
export type SurrealAdapterArgs = {
    auth?: {
        password: string;
        username: string;
    };
    database?: string;
    migrationDir?: string;
    namespace?: string;
    requestTimeoutMs?: number;
    tablePrefix?: string;
    url?: string;
};
export type SurrealAdapter = BaseDatabaseAdapter & Required<Pick<SurrealAdapterArgs, 'database' | 'namespace' | 'url'>> & Omit<SurrealAdapterArgs, 'database' | 'namespace' | 'url'> & {
    client: SurrealClient;
    enums?: Record<string, unknown>;
    execute?: typeof execute;
    idType?: 'uuid';
    tables?: Record<string, unknown>;
};
declare const execute: (this: SurrealAdapter, args: {
    raw?: string;
    sql?: unknown;
}) => Promise<{
    rows: {
        extra_column: number;
    }[];
}>;
export declare function surrealAdapter(args?: SurrealAdapterArgs): DatabaseAdapterObj<SurrealAdapter>;
