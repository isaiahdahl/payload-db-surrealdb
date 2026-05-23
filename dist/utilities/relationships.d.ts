import type { SurrealAdapter } from '../index.js';
type Field = {
    blocks?: Array<{
        fields?: Field[];
        slug?: string;
    }>;
    collection?: string | string[];
    defaultLimit?: number;
    fields?: Field[];
    hasMany?: boolean;
    limit?: number;
    localized?: boolean;
    orderable?: boolean;
    name?: string;
    on?: string;
    relationTo?: string | string[];
    sort?: string | string[];
    defaultSort?: string | string[];
    tabs?: Array<{
        fields?: Field[];
        localized?: boolean;
        name?: string;
    }>;
    type?: string;
};
export declare const relationshipStorageSemantics: {
    readonly simple: "relationship/upload fields store the related document id as a string/number scalar";
    readonly simpleHasMany: "hasMany relationship/upload fields store an array of related ids";
    readonly polymorphic: "polymorphic relationship fields store { relationTo, value } objects, or arrays of them for hasMany";
};
export declare const transformRelationshipWrites: (data: Record<string, unknown>, fields?: Field[]) => Record<string, unknown>;
export declare const transformRelationshipReads: <T extends Record<string, unknown>>(adapter: SurrealAdapter, collection: string, docs: T[], depth?: number, joins?: Record<string, {
    limit?: number;
    page?: number;
    sort?: string | string[];
} | false>) => Promise<T[]>;
export declare const transformRelationshipWhere: (collectionConfig: {
    fields?: Field[];
} | undefined, where: unknown) => unknown;
export declare const buildRelationshipAwareWhere: (adapter: SurrealAdapter, collection: string, where: unknown) => string;
export {};
