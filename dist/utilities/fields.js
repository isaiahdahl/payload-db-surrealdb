export const getCollectionConfig = (adapter, slug) => adapter.payload?.config?.collections?.find((collection) => collection.slug === slug);
export const hasTimestamps = (adapter, slug) => {
    const collection = getCollectionConfig(adapter, slug);
    return collection?.timestamps !== false;
};
const cloneDefault = (value) => {
    if (typeof value === 'function') {
        return value();
    }
    if (value === undefined || value === null) {
        return value;
    }
    return structuredClone(value);
};
const getNestedFields = (field, value) => {
    if (field.type === 'tabs') {
        return (field.tabs ?? []).flatMap((tab) => tab.fields ?? []);
    }
    if (field.type === 'blocks' && value && typeof value === 'object' && !Array.isArray(value)) {
        const blockType = value.blockType;
        const block = (field.blocks ?? []).find((candidate) => candidate.slug === blockType);
        return block?.fields ?? [];
    }
    return field.fields ?? [];
};
const transformValueForWrite = (value, field) => {
    if (value === undefined) {
        return value;
    }
    if (field.type === 'date') {
        if (typeof value === 'number') {
            return new Date(value).toISOString();
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
    }
    // Payload's point field shape is [longitude, latitude]. Store it losslessly rather than
    // converting to a GeoJSON object that Payload will not expect on reads.
    if (field.type === 'point' && Array.isArray(value)) {
        return value;
    }
    if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
        return value.map((row) => {
            if (row && typeof row === 'object' && !Array.isArray(row)) {
                return applyDefaults(row, getNestedFields(field, row));
            }
            return row;
        });
    }
    const nestedFields = getNestedFields(field, value);
    if (!nestedFields.length) {
        return value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return applyDefaults(value, nestedFields);
    }
    return value;
};
export const applyDefaults = (data, fields = []) => {
    for (const field of fields) {
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? []) {
                if (tab.name) {
                    const value = data[tab.name];
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        data[tab.name] = applyDefaults(value, tab.fields ?? []);
                    }
                    else if (value === undefined) {
                        data[tab.name] = applyDefaults({}, tab.fields ?? []);
                    }
                }
                else {
                    applyDefaults(data, tab.fields ?? []);
                }
            }
            continue;
        }
        if (!field.name) {
            if (field.fields?.length) {
                applyDefaults(data, field.fields);
            }
            continue;
        }
        if (data[field.name] === undefined && field.defaultValue !== undefined) {
            data[field.name] = cloneDefault(field.defaultValue);
        }
        data[field.name] = transformValueForWrite(data[field.name], field);
    }
    return data;
};
export const getValueAtPath = (doc, path) => {
    if (path === 'id') {
        return doc.id;
    }
    return path.split('.').reduce((value, part) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value[part];
        }
        return undefined;
    }, doc);
};
export const setValueAtPath = (doc, path, value) => {
    const parts = path.split('.');
    let target = doc;
    for (const [index, part] of parts.entries()) {
        if (index === parts.length - 1) {
            target[part] = value;
            return;
        }
        if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) {
            target[part] = {};
        }
        target = target[part];
    }
};
export const applySelect = (doc, select) => {
    if (!doc || !select || Object.keys(select).length === 0) {
        return doc;
    }
    const entries = Object.entries(select).filter(([, value]) => Boolean(value));
    if (!entries.length) {
        return doc;
    }
    const projected = { id: doc.id };
    for (const [path] of entries) {
        const value = getValueAtPath(doc, path);
        if (value !== undefined) {
            setValueAtPath(projected, path, value);
        }
    }
    return projected;
};
const simpleIndexFieldTypes = new Set([
    'checkbox',
    'code',
    'date',
    'email',
    'number',
    'radio',
    'select',
    'text',
    'textarea',
]);
export const getIndexedFields = (fields = []) => {
    const indexedFields = [];
    for (const field of fields) {
        if (!field.name) {
            continue;
        }
        if ((field.index || field.unique) && simpleIndexFieldTypes.has(field.type ?? '')) {
            indexedFields.push({ name: field.name, unique: Boolean(field.unique) });
        }
    }
    return indexedFields;
};
