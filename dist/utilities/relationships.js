import { buildWhere } from '../queries/buildWhere.js';
import { getCollectionConfig } from './fields.js';
import { escapeIdent, literal, normalizeDocument } from './sql.js';
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isRelationshipField = (field) => field.type === 'relationship' || field.type === 'upload';
const isPolymorphic = (field) => Array.isArray(field.relationTo);
export const relationshipStorageSemantics = {
    simple: 'relationship/upload fields store the related document id as a string/number scalar',
    simpleHasMany: 'hasMany relationship/upload fields store an array of related ids',
    polymorphic: 'polymorphic relationship fields store { relationTo, value } objects, or arrays of them for hasMany',
};
const getRefID = (value) => {
    if (isPlainObject(value)) {
        if ('id' in value) {
            return value.id;
        }
        if ('value' in value && Object.keys(value).length <= 2) {
            return getRefID(value.value);
        }
    }
    return value;
};
const normalizePolymorphicRef = (value) => {
    if (!isPlainObject(value) || typeof value.relationTo !== 'string') {
        return value;
    }
    return {
        relationTo: value.relationTo,
        value: getRefID(value.value),
    };
};
const normalizeRelationshipValue = (field, value) => {
    if (value === null || value === undefined) {
        return value;
    }
    if (isPlainObject(value) && Object.keys(value).some((key) => key.startsWith('$'))) {
        return Object.fromEntries(Object.entries(value).map(([operator, operatorValue]) => [
            operator,
            operator === '$push' || operator === '$remove'
                ? normalizeRelationshipValue(field, operatorValue)
                : operatorValue,
        ]));
    }
    if (isPolymorphic(field)) {
        return field.hasMany && Array.isArray(value) ? value.map(normalizePolymorphicRef) : normalizePolymorphicRef(value);
    }
    return field.hasMany && Array.isArray(value) ? value.map(getRefID) : getRefID(value);
};
const getNestedFields = (field, value) => {
    if (field.type === 'blocks' && isPlainObject(value)) {
        const block = (field.blocks ?? []).find((candidate) => candidate.slug === value.blockType);
        return block?.fields ?? [];
    }
    return field.fields ?? [];
};
const transformRelationshipValueWrites = (value, field) => {
    if (value === null || value === undefined) {
        return value;
    }
    if (field.localized && isPlainObject(value) && !Object.keys(value).some((key) => key.startsWith('$'))) {
        return Object.fromEntries(Object.entries(value).map(([locale, localeValue]) => [
            locale,
            transformRelationshipValueWrites(localeValue, { ...field, localized: false }),
        ]));
    }
    if (isRelationshipField(field)) {
        return normalizeRelationshipValue(field, value);
    }
    if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
        return value.map((row) => isPlainObject(row) ? transformRelationshipWrites(row, getNestedFields(field, row)) : row);
    }
    const nestedFields = getNestedFields(field, value);
    if (nestedFields.length && isPlainObject(value)) {
        return transformRelationshipWrites(value, nestedFields);
    }
    return value;
};
export const transformRelationshipWrites = (data, fields = []) => {
    for (const field of fields) {
        if (!field.name || !(field.name in data)) {
            continue;
        }
        data[field.name] = transformRelationshipValueWrites(data[field.name], field);
    }
    return data;
};
const collectRelationshipFields = (fields = []) => fields.filter(isRelationshipField);
const collectJoinFields = (fields = []) => fields.filter((field) => field.type === 'join' && field.name);
const getSortSQL = (sort) => {
    const sortValue = Array.isArray(sort) ? sort[0] : sort;
    if (!sortValue) {
        return 'ORDER BY createdAt DESC';
    }
    const direction = sortValue.startsWith('-') ? 'DESC' : 'ASC';
    const field = sortValue.replace(/^-/, '');
    return `ORDER BY ${field} ${direction}`;
};
const getRelationCollections = (field) => {
    if (field.type === 'upload' && typeof field.relationTo !== 'string') {
        return [field.relationTo].filter(Boolean);
    }
    if (Array.isArray(field.relationTo)) {
        return field.relationTo;
    }
    return typeof field.relationTo === 'string' ? [field.relationTo] : [];
};
const normalizeFetchedDocs = (docs) => (docs ?? []).map((doc) => normalizeDocument(doc)).filter(Boolean);
const fetchByIDs = async (adapter, collection, ids, depth) => {
    const uniqueIDs = [...new Set(ids.filter((id) => id !== null && id !== undefined).map(String))];
    const docsByID = new Map();
    if (!uniqueIDs.length) {
        return docsByID;
    }
    const table = escapeIdent(collection.replaceAll('-', '_'));
    const docs = normalizeFetchedDocs(await adapter.client.query(`SELECT * FROM ${table} WHERE meta::id(id) IN ${literal(uniqueIDs)};`));
    const populated = await transformRelationshipReads(adapter, collection, docs, depth);
    for (const doc of populated) {
        docsByID.set(String(doc.id), doc);
    }
    return docsByID;
};
const populateRelationshipFields = async (adapter, collection, docs, depth) => {
    if (depth <= 0 || !docs.length) {
        return;
    }
    const fields = collectRelationshipFields(getCollectionConfig(adapter, collection)?.fields);
    for (const field of fields) {
        if (!field.name) {
            continue;
        }
        if (isPolymorphic(field)) {
            const idsByCollection = new Map();
            for (const doc of docs) {
                const value = doc[field.name];
                const refs = field.hasMany && Array.isArray(value) ? value : value ? [value] : [];
                for (const ref of refs) {
                    if (isPlainObject(ref) && typeof ref.relationTo === 'string') {
                        idsByCollection.set(ref.relationTo, [...(idsByCollection.get(ref.relationTo) ?? []), ref.value]);
                    }
                }
            }
            const docsByCollection = new Map();
            for (const [relationTo, ids] of idsByCollection) {
                docsByCollection.set(relationTo, await fetchByIDs(adapter, relationTo, ids, depth - 1));
            }
            for (const doc of docs) {
                const value = doc[field.name];
                const populateRef = (ref) => {
                    if (!isPlainObject(ref) || typeof ref.relationTo !== 'string') {
                        return ref;
                    }
                    return {
                        relationTo: ref.relationTo,
                        value: docsByCollection.get(ref.relationTo)?.get(String(ref.value)) ?? ref.value,
                    };
                };
                doc[field.name] = field.hasMany && Array.isArray(value) ? value.map(populateRef) : populateRef(value);
            }
            continue;
        }
        const relationTo = getRelationCollections(field)[0];
        if (!relationTo) {
            continue;
        }
        const ids = docs.flatMap((doc) => {
            const value = doc[field.name];
            return field.hasMany && Array.isArray(value) ? value : value ? [value] : [];
        });
        const related = await fetchByIDs(adapter, relationTo, ids, depth - 1);
        for (const doc of docs) {
            const value = doc[field.name];
            doc[field.name] = field.hasMany && Array.isArray(value)
                ? value.map((id) => related.get(String(id)) ?? id)
                : value === null || value === undefined
                    ? value
                    : related.get(String(value)) ?? value;
        }
    }
};
const resolveJoinFields = async (adapter, collection, docs, depth) => {
    if (!docs.length) {
        return;
    }
    const joinFields = collectJoinFields(getCollectionConfig(adapter, collection)?.fields);
    const parentIDs = docs.map((doc) => doc.id).filter((id) => id !== null && id !== undefined);
    for (const field of joinFields) {
        if (!field.name || !field.collection || !field.on || !parentIDs.length) {
            continue;
        }
        const limit = field.limit ?? field.defaultLimit ?? 10;
        const targetTable = escapeIdent(field.collection.replaceAll('-', '_'));
        const sort = getSortSQL(field.sort);
        const targetDocs = normalizeFetchedDocs(await adapter.client.query(`SELECT * FROM ${targetTable} WHERE ${field.on} IN ${literal(parentIDs.map(String))} ${sort};`));
        const populatedTargets = depth > 0 ? await transformRelationshipReads(adapter, field.collection, targetDocs, depth - 1) : targetDocs;
        const byParent = new Map();
        for (const [index, targetDoc] of targetDocs.entries()) {
            const foreignValue = targetDoc[field.on];
            const ids = Array.isArray(foreignValue) ? foreignValue : [foreignValue];
            for (const id of ids) {
                const key = String(id);
                byParent.set(key, [...(byParent.get(key) ?? []), populatedTargets[index]]);
            }
        }
        for (const doc of docs) {
            const joined = byParent.get(String(doc.id)) ?? [];
            const pageDocs = limit > 0 ? joined.slice(0, limit) : joined;
            doc[field.name] = field.hasMany === false
                ? (pageDocs[0] ?? null)
                : {
                    docs: pageDocs,
                    hasNextPage: limit > 0 ? joined.length > limit : false,
                    hasPrevPage: false,
                    limit,
                    page: 1,
                    pagingCounter: 1,
                    totalDocs: joined.length,
                    totalPages: limit > 0 ? Math.ceil(joined.length / limit) : 1,
                };
        }
    }
};
export const transformRelationshipReads = async (adapter, collection, docs, depth = 0) => {
    await populateRelationshipFields(adapter, collection, docs, depth);
    await resolveJoinFields(adapter, collection, docs, depth);
    return docs;
};
export const transformRelationshipWhere = (collectionConfig, where) => {
    if (!isPlainObject(where)) {
        return where;
    }
    const fields = collectionConfig?.fields ?? [];
    const fieldByName = new Map(fields.filter((field) => field.name).map((field) => [field.name, field]));
    return Object.fromEntries(Object.entries(where).map(([key, value]) => {
        if ((key === 'and' || key === 'or') && Array.isArray(value)) {
            return [key, value.map((entry) => transformRelationshipWhere(collectionConfig, entry))];
        }
        const rootField = key.split('.')[0];
        const field = fieldByName.get(rootField);
        if (!field || !isRelationshipField(field) || !isPlainObject(value)) {
            return [key, value];
        }
        return [
            key,
            Object.fromEntries(Object.entries(value).map(([operator, operatorValue]) => [
                operator,
                operator === 'in' || operator === 'not_in'
                    ? Array.isArray(operatorValue)
                        ? operatorValue.map((item) => normalizeRelationshipValue(field, item))
                        : operatorValue
                    : normalizeRelationshipValue(field, operatorValue),
            ])),
        ];
    }));
};
export const buildRelationshipAwareWhere = (adapter, collection, where) => {
    const config = getCollectionConfig(adapter, collection);
    return buildWhere(transformRelationshipWhere(config, where), config?.fields);
};
