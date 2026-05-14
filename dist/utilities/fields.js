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
const isOperatorObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some((key) => key.startsWith('$')));
const transformValueForWrite = (value, field) => {
    if (value === undefined || isOperatorObject(value)) {
        return value;
    }
    if (field.hasMany && Array.isArray(value)) {
        return value.map((item) => transformValueForWrite(item, { ...field, hasMany: false }));
    }
    if (field.localized && value && typeof value === 'object' && !Array.isArray(value) && !isOperatorObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([locale, localeValue]) => [
            locale,
            transformValueForWrite(localeValue, { ...field, localized: false }),
        ]));
    }
    if (field.type === 'date') {
        if (typeof value === 'number') {
            return new Date(value).toISOString();
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
    }
    if (field.type === 'text' || field.type === 'textarea' || field.type === 'email') {
        return value === null ? value : String(value);
    }
    if (field.type === 'number') {
        if (value === null || value === '') {
            return value;
        }
        const number = Number(value);
        return Number.isNaN(number) ? value : number;
    }
    // Payload expects default point values written through db.create as GeoJSON-like objects.
    if (field.type === 'point' && Array.isArray(value)) {
        return { type: 'Point', coordinates: value };
    }
    if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
        return value.map((row) => {
            if (row && typeof row === 'object' && !Array.isArray(row)) {
                const sanitized = sanitizeDataForWrite(row, getNestedFields(field, row));
                if (field.type === 'blocks' && 'blockType' in row)
                    sanitized.blockType = row.blockType;
                if ('id' in row)
                    sanitized.id = row.id;
                return sanitized;
            }
            return row;
        });
    }
    const nestedFields = getNestedFields(field, value);
    if (!nestedFields.length) {
        return value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return sanitizeDataForWrite(value, nestedFields);
    }
    return value;
};
export const applyDefaults = (data, fields = []) => sanitizeDataForWrite(data, fields);
export const sanitizeDataForWrite = (data, fields = []) => {
    if (!fields.length) {
        return { ...data };
    }
    const output = {};
    if (data.id !== undefined) {
        output.id = data.id;
    }
    for (const field of fields) {
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? []) {
                if (tab.name) {
                    const value = data[tab.name];
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        output[tab.name] = sanitizeDataForWrite(value, tab.fields ?? []);
                    }
                    else if (value === undefined) {
                        const nested = sanitizeDataForWrite({}, tab.fields ?? []);
                        if (Object.keys(nested).length)
                            output[tab.name] = nested;
                    }
                }
                else {
                    Object.assign(output, sanitizeDataForWrite(data, tab.fields ?? []));
                }
            }
            continue;
        }
        if (!field.name) {
            if (field.fields?.length) {
                Object.assign(output, sanitizeDataForWrite(data, field.fields));
            }
            continue;
        }
        if (field.virtual) {
            continue;
        }
        let value = data[field.name];
        if (value === undefined && field.defaultValue !== undefined) {
            value = cloneDefault(field.defaultValue);
        }
        if (value !== undefined) {
            output[field.name] = transformValueForWrite(value, field);
        }
    }
    return output;
};
export const getValueAtPath = (doc, path) => {
    if (path === 'id') {
        return doc.id;
    }
    const getValue = (value, parts) => {
        if (!parts.length) {
            return value;
        }
        if (Array.isArray(value)) {
            const values = value
                .flatMap((item) => {
                const nestedValue = getValue(item, parts);
                return Array.isArray(nestedValue) ? nestedValue : [nestedValue];
            })
                .filter((item) => item !== undefined);
            return values.length ? values : undefined;
        }
        if (value && typeof value === 'object') {
            const [part, ...rest] = parts;
            const objectValue = value;
            if (part in objectValue) {
                return getValue(objectValue[part], rest);
            }
            if (typeof objectValue.relationTo === 'string' && objectValue.value && typeof objectValue.value === 'object') {
                return getValue(objectValue.value, parts);
            }
        }
        return undefined;
    };
    return getValue(doc, path.split('.'));
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
