export const escapeIdent = (value) => {
    return `⟨${value.replaceAll('⟩', '\\⟩')}⟩`;
};
export const literal = (value) => {
    if (value === undefined) {
        return 'NONE';
    }
    return JSON.stringify(value);
};
export const getTableName = (slug) => slug.replaceAll('-', '_');
export const getRecordID = (table, id) => {
    return `type::record(${literal(table)}, ${literal(String(id))})`;
};
export const normalizeID = (id) => {
    if (typeof id === 'string') {
        const separatorIndex = id.indexOf(':');
        const value = separatorIndex > -1 ? id.slice(separatorIndex + 1) : id;
        const cleaned = value.replace(/^`|`$/g, '');
        return /^\d+$/.test(cleaned) ? Number(cleaned) : cleaned;
    }
    if (id && typeof id === 'object') {
        const candidate = id;
        if (candidate.id !== undefined) {
            return normalizeID(String(candidate.id));
        }
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
