export type PaginationInfo = {
    currentPage: number;
    limit: number;
    start: number;
};
export declare const getPagination: (args: Record<string, any>) => PaginationInfo;
