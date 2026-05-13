type Field = {
    defaultValue?: unknown;
    fields?: Field[];
    name?: string;
    type?: string;
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
export {};
