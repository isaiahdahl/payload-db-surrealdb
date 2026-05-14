type Field = {
    blocks?: Array<{
        fields?: Field[];
        slug?: string;
    }>;
    defaultValue?: unknown;
    fields?: Field[];
    index?: boolean;
    name?: string;
    tabs?: Array<{
        fields?: Field[];
        name?: string;
    }>;
    type?: string;
    unique?: boolean;
};
export declare const getCollectionConfig: (adapter: {
    payload?: {
        config?: {
            collections?: any[];
        };
    };
}, slug: string) => any;
export declare const hasTimestamps: (adapter: {
    payload?: {
        config?: {
            collections?: any[];
        };
    };
}, slug: string) => boolean;
export declare const applyDefaults: (data: Record<string, unknown>, fields?: Field[]) => Record<string, unknown>;
export declare const getValueAtPath: (doc: Record<string, unknown>, path: string) => unknown;
export declare const setValueAtPath: (doc: Record<string, unknown>, path: string, value: unknown) => void;
export declare const applySelect: <T extends Record<string, unknown> | null>(doc: T, select?: Record<string, unknown>) => T;
export type IndexedField = {
    name: string;
    unique: boolean;
};
export declare const getIndexedFields: (fields?: Field[]) => IndexedField[];
export {};
