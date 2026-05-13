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
    tablePrefix?: string;
    url?: string;
};
export type SurrealAdapter = BaseDatabaseAdapter & Required<Pick<SurrealAdapterArgs, 'database' | 'namespace' | 'url'>> & Omit<SurrealAdapterArgs, 'database' | 'namespace' | 'url'> & {
    client: SurrealClient;
};
export declare function surrealAdapter(args?: SurrealAdapterArgs): DatabaseAdapterObj<SurrealAdapter>;
