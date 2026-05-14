import type { SurrealAdapter } from './index.js';
export type SurrealHTTPResult<T = unknown> = {
    result?: T;
    status: 'ERR' | 'OK';
    time?: string;
};
export type SurrealClient = {
    query: <T = unknown>(sql: string, options?: {
        timeoutMs?: number;
    }) => Promise<T>;
};
export declare class SurrealDBError extends Error {
    cause?: unknown;
    code?: string;
    duplicate: boolean;
    status?: number;
    constructor(message: string, options?: {
        cause?: unknown;
        code?: string;
        duplicate?: boolean;
        status?: number;
    });
}
export declare const createClient: (adapter: SurrealAdapter) => SurrealClient;
