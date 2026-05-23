import type { Where } from 'payload';
type Field = {
    blocks?: Array<{
        fields?: Field[];
    }>;
    fields?: Field[];
    hasMany?: boolean;
    name?: string;
    tabs?: Array<{
        fields?: Field[];
        name?: string;
    }>;
    type?: string;
};
export declare const pathToSQL: (path: string) => string;
export declare const buildWhere: (where?: Where, fields?: Field[]) => string;
export {};
