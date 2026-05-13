import type { SurrealAdapter } from './index.js';
export type SurrealHTTPResult<T = unknown> = {
    result?: T;
    status: 'ERR' | 'OK';
    time?: string;
};
export type SurrealClient = {
    query: <T = unknown>(sql: string) => Promise<T>;
};
export declare const createClient: (adapter: SurrealAdapter) => SurrealClient;
