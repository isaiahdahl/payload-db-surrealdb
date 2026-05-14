import type { Where } from 'payload';
type Field = {
    hasMany?: boolean;
    name?: string;
    type?: string;
};
export declare const pathToSQL: (path: string) => string;
export declare const buildWhere: (where?: Where, fields?: Field[]) => string;
export {};
