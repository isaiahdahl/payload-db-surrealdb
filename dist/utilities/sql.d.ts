export declare const escapeIdent: (value: string) => string;
export declare const literal: (value: unknown) => string;
export declare const getTableName: (slug: string) => string;
export declare const getRecordID: (table: string, id: number | string) => string;
export declare const normalizeID: (id: unknown) => number | string;
export declare const normalizeDocument: <T extends Record<string, unknown>>(doc: T | null | undefined) => T | null;
