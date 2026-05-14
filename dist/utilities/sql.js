export const escapeIdent = (value) => {
    return `⟨${value.replaceAll('⟩', '\\⟩')}⟩`;
};
export const literal = (value) => {
    if (value === undefined) {
        return 'NONE';
    }
    return JSON.stringify(value);
};
export const normalizeTableComponent = (value) => value.replaceAll('-', '_');
export const getTableName = (slug, tablePrefix) => {
    const table = normalizeTableComponent(slug);
    const prefix = tablePrefix ? normalizeTableComponent(tablePrefix).replace(/_+$/, '') : '';
    return prefix ? `${prefix}_${table}` : table;
};
export const getRecordID = (table, id) => {
    return `type::record(${literal(table)}, ${literal(String(id))})`;
};
export const normalizeID = (id) => {
    if (typeof id === 'string') {
        const separatorIndex = id.indexOf(':');
        const value = separatorIndex > -1 ? id.slice(separatorIndex + 1) : id;
        return value.replace(/^`|`$/g, '');
    }
    if (id && typeof id === 'object') {
        const candidate = id;
        if (candidate.id !== undefined) {
            return normalizeID(candidate.id);
        }
    }
    if (typeof id === 'number') {
        return id;
    }
    return String(id);
};
export const normalizeDocument = (doc) => {
    if (!doc) {
        return null;
    }
    if (doc.id !== undefined) {
        return {
            ...doc,
            id: normalizeID(doc.id),
        };
    }
    return doc;
};
