import type { CreateMigration } from 'payload';
import type { SurrealAdapter } from './index.js';
export declare const createMigration: CreateMigration;
export declare function migrate(this: SurrealAdapter): Promise<void>;
export declare function migrateDown(): Promise<void>;
export declare function migrateRefresh(this: SurrealAdapter): Promise<void>;
export declare function migrateReset(this: SurrealAdapter): Promise<void>;
export declare function migrateStatus(): Promise<void>;
export declare function migrateFresh(this: SurrealAdapter): Promise<void>;
export type MigrateUpArgs = {
    payload: unknown;
};
export type MigrateDownArgs = {
    payload: unknown;
};
