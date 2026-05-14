import type { CreateMigration, Migration, Payload } from 'payload';
import type { SurrealAdapter } from './index.js';
export declare const createMigration: CreateMigration;
export declare function migrate(this: SurrealAdapter, args?: {
    migrations?: Migration[];
}): Promise<void>;
export declare function migrateDown(this: SurrealAdapter, args?: {
    migrations?: Migration[];
}): Promise<void>;
export declare function migrateRefresh(this: SurrealAdapter, args?: {
    migrations?: Migration[];
}): Promise<void>;
export declare function migrateReset(this: SurrealAdapter, args?: {
    migrations?: Migration[];
}): Promise<void>;
export declare function migrateStatus(this: SurrealAdapter): Promise<void>;
export declare function migrateFresh(this: SurrealAdapter, args?: {
    forceAcceptWarning?: boolean;
    migrations?: Migration[];
}): Promise<void>;
export type MigrateUpArgs = {
    payload: Payload;
};
export type MigrateDownArgs = {
    payload: Payload;
};
