export const getCollectionConfig = (adapter, slug) => adapter.payload?.config?.collections?.find((collection) => collection.slug === slug);
export const hasTimestamps = (adapter, slug) => {
    const collection = getCollectionConfig(adapter, slug);
    return collection?.timestamps !== false;
};
export const applyDefaults = (data, fields = []) => {
    for (const field of fields) {
        if (!field.name) {
            continue;
        }
        if (data[field.name] === undefined && field.defaultValue !== undefined) {
            data[field.name] = typeof field.defaultValue === 'function' ? field.defaultValue() : structuredClone(field.defaultValue);
        }
        if (field.type === 'date' && typeof data[field.name] === 'number') {
            data[field.name] = new Date(data[field.name]).toISOString();
        }
        if (field.type === 'point' && Array.isArray(data[field.name])) {
            data[field.name] = { type: 'Point', coordinates: data[field.name] };
        }
        if (field.fields?.length) {
            if (field.type === 'array' && Array.isArray(data[field.name])) {
                data[field.name] = data[field.name].map((row) => applyDefaults(row, field.fields ?? []));
            }
            else if (data[field.name] && typeof data[field.name] === 'object') {
                data[field.name] = applyDefaults(data[field.name], field.fields);
            }
        }
    }
    return data;
};
