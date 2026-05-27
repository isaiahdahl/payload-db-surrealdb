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
    if (field.type === 'tabs') {
        return (field.tabs ?? []).flatMap((tab) => tab.fields ?? []);
    }
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
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? []) {
                if (tab.name) {
                    if (isPlainObject(data[tab.name])) {
                        if (tab.localized) {
                            for (const localeValue of Object.values(data[tab.name])) {
                                if (isPlainObject(localeValue))
                                    transformRelationshipWrites(localeValue, tab.fields ?? []);
                            }
                        }
                        else {
                            transformRelationshipWrites(data[tab.name], tab.fields ?? []);
                        }
                    }
                }
                else {
                    transformRelationshipWrites(data, tab.fields ?? []);
                }
            }
            continue;
        }
        if (!field.name || !(field.name in data)) {
            continue;
        }
        data[field.name] = transformRelationshipValueWrites(data[field.name], field);
    }
    return data;
};
const collectRelationshipFields = (fields = []) => fields.filter(isRelationshipField);
const collectJoinFields = (fields = [], prefix = []) => {
    const joins = [];
    for (const field of fields) {
        if (field.type === 'join' && field.name) {
            joins.push({ ...field, name: [...prefix, field.name].join('.') });
            continue;
        }
        if (field.type === 'group' && field.name) {
            joins.push(...collectJoinFields(field.fields ?? [], [...prefix, field.name]));
            continue;
        }
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? []) {
                joins.push(...collectJoinFields(tab.fields ?? [], tab.name ? [...prefix, tab.name] : prefix));
            }
        }
    }
    return joins;
};
const sortValues = (sort) => (Array.isArray(sort) ? sort : sort ? [sort] : [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
const compareValues = (a, b) => {
    if (a === b)
        return 0;
    if (a === null || a === undefined)
        return 1;
    if (b === null || b === undefined)
        return -1;
    return String(a).localeCompare(String(b));
};
const sortJoinDocs = (docs, sort) => {
    const values = sortValues(sort).length ? sortValues(sort) : ['-createdAt'];
    return [...docs].sort((a, b) => {
        for (const sortValue of values) {
            const direction = sortValue.startsWith('-') ? -1 : 1;
            const path = sortValue.replace(/^-|^\+/, '');
            const aValue = getValueAtPath('value' in a && 'relationTo' in a ? a.value : a, path);
            const bValue = getValueAtPath('value' in b && 'relationTo' in b ? b.value : b, path);
            const result = compareValues(aValue, bValue);
            if (result !== 0)
                return direction * result;
        }
        if ('relationTo' in a && 'relationTo' in b)
            return compareValues(b.relationTo, a.relationTo);
        return 0;
    });
};
const filterJoinWhereForCollection = (where, collection) => {
    if (!isPlainObject(where))
        return where;
    const entries = Object.entries(where).flatMap(([key, value]) => {
        if ((key === 'and' || key === 'or') && Array.isArray(value)) {
            const filtered = value
                .map((entry) => filterJoinWhereForCollection(entry, collection))
                .filter((entry) => isPlainObject(entry) && Object.keys(entry).length > 0);
            return filtered.length ? [[key, filtered]] : [];
        }
        if (key !== 'relationTo')
            return [[key, value]];
        if (!isPlainObject(value))
            return [];
        const equals = value.equals;
        const inValue = value.in;
        const matches = equals === collection || (Array.isArray(inValue) && inValue.includes(collection));
        return matches ? [] : [['id', { equals: null }]];
    });
    return Object.fromEntries(entries);
};
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
const stripUndefined = (value) => {
    if (Array.isArray(value))
        return value.map(stripUndefined);
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value)
            .filter(([, nested]) => nested !== undefined)
            .map(([key, nested]) => [key, stripUndefined(nested)]));
    }
    return value;
};
const normalizeFetchedDocs = (docs) => (docs ?? []).map((doc) => stripUndefined(normalizeDocument(doc))).filter(Boolean);
const getVersionBaseCollection = (adapter, collection) => {
    if (!collection.endsWith('_versions'))
        return undefined;
    const baseCollection = collection.slice(0, -'_versions'.length);
    return getCollectionConfig(adapter, baseCollection) ? baseCollection : undefined;
};
const fetchByIDs = async (adapter, collection, ids, depth) => {
    const uniqueIDs = [...new Set(ids.filter((id) => id !== null && id !== undefined).map(String))];
    const docsByID = new Map();
    if (!uniqueIDs.length) {
        return docsByID;
    }
    const table = escapeIdent(collection.replaceAll('-', '_'));
    const config = getCollectionConfig(adapter, collection);
    const idField = config?.fields?.find((field) => field.name === 'id');
    const hasNumericIDs = idField?.type === 'number' || config?.customIDType === 'number' || collection.endsWith('-number');
    const docs = normalizeFetchedDocs(await adapter.client.query(`SELECT * FROM ${table} WHERE meta::id(id) IN ${literal(uniqueIDs)};`)).map((doc) => hasNumericIDs && typeof doc.id === 'string' && !Number.isNaN(Number(doc.id)) ? { ...doc, id: Number(doc.id) } : doc);
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
    const populateField = async (field, targetDocs) => {
        if (!field.name || !targetDocs.length) {
            return;
        }
        if (field.localized) {
            const localeEntries = [];
            const scalarLocaleDocs = [];
            for (const doc of targetDocs) {
                const value = doc[field.name];
                if (!isPlainObject(value)) {
                    scalarLocaleDocs.push(doc);
                    continue;
                }
                for (const [locale, localeValue] of Object.entries(value)) {
                    const wrapper = { [field.name]: localeValue };
                    localeEntries.push({ doc, locale, wrapper });
                }
            }
            await populateField({ ...field, localized: false }, localeEntries.map((entry) => entry.wrapper));
            await populateField({ ...field, localized: false }, scalarLocaleDocs);
            for (const { doc, locale, wrapper } of localeEntries) {
                ;
                doc[field.name][locale] = wrapper[field.name];
            }
            return;
        }
        if (isPolymorphic(field)) {
            const idsByCollection = new Map();
            for (const doc of targetDocs) {
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
            for (const doc of targetDocs) {
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
            return;
        }
        const relationTo = getRelationCollections(field)[0];
        if (!relationTo) {
            return;
        }
        const ids = targetDocs.flatMap((doc) => {
            const value = doc[field.name];
            return field.hasMany && Array.isArray(value) ? value : value ? [value] : [];
        });
        const related = await fetchByIDs(adapter, relationTo, ids, depth - 1);
        for (const doc of targetDocs) {
            const value = doc[field.name];
            doc[field.name] = field.hasMany && Array.isArray(value)
                ? value.map((id) => related.get(String(id)) ?? id)
                : value === null || value === undefined
                    ? value
                    : related.get(String(value)) ?? value;
        }
    };
    const populateFields = async (targetDocs, fields = []) => {
        for (const field of fields) {
            if (field.type === 'tabs') {
                for (const tab of field.tabs ?? []) {
                    if (tab.name) {
                        await populateFields(targetDocs.map((doc) => doc[tab.name]).filter(isPlainObject), tab.fields ?? []);
                    }
                    else {
                        await populateFields(targetDocs, tab.fields ?? []);
                    }
                }
                continue;
            }
            if (isRelationshipField(field)) {
                await populateField(field, targetDocs);
                continue;
            }
            if (!field.name) {
                continue;
            }
            if (field.type === 'array' || field.type === 'blocks') {
                for (const doc of targetDocs) {
                    const rows = doc[field.name];
                    if (!Array.isArray(rows)) {
                        continue;
                    }
                    for (const row of rows) {
                        if (isPlainObject(row)) {
                            await populateFields([row], getNestedFields(field, row));
                        }
                    }
                }
                continue;
            }
            const nestedFields = getNestedFields(field);
            if (nestedFields.length) {
                await populateFields(targetDocs.map((doc) => doc[field.name]).filter(isPlainObject), nestedFields);
            }
        }
    };
    await populateFields(docs, getCollectionConfig(adapter, collection)?.fields);
};
const getLocaleCodes = (adapter) => {
    const localization = adapter.payload.config.localization;
    const locales = typeof localization === 'object' && Array.isArray(localization.locales) ? localization.locales : [];
    return locales.map((locale) => typeof locale === 'string' ? locale : locale.code).filter(Boolean);
};
const getDefaultLocale = (adapter) => {
    const localization = adapter.payload.config.localization;
    return typeof localization === 'object' ? localization.defaultLocale : undefined;
};
const pickLocaleWrapperValue = (value, localeCodes, defaultLocale) => {
    if (!localeCodes.some((locale) => locale in value))
        return undefined;
    if (defaultLocale && defaultLocale in value)
        return value[defaultLocale];
    const first = localeCodes.find((locale) => locale in value);
    return first ? value[first] : undefined;
};
const getValueAtPath = (value, path, localeCodes = [], defaultLocale) => {
    const [head, ...tail] = path.split('.').filter(Boolean);
    if (!head) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => getValueAtPath(item, path, localeCodes, defaultLocale));
    }
    if (!isPlainObject(value)) {
        return undefined;
    }
    if (!(head in value)) {
        const localeValue = pickLocaleWrapperValue(value, localeCodes, defaultLocale);
        if (localeValue !== undefined)
            return getValueAtPath(localeValue, path, localeCodes, defaultLocale);
    }
    return getValueAtPath(value[head], tail.join('.'), localeCodes, defaultLocale);
};
const setValueAtPath = (doc, path, value) => {
    const parts = path.split('.').filter(Boolean);
    const last = parts.pop();
    if (!last) {
        return;
    }
    let target = doc;
    for (const part of parts) {
        if (!isPlainObject(target[part])) {
            target[part] = {};
        }
        target = target[part];
    }
    target[last] = value;
};
const flattenJoinValues = (value, localeCodes = [], defaultLocale) => {
    if (Array.isArray(value)) {
        return value.flatMap((item) => flattenJoinValues(item, localeCodes, defaultLocale));
    }
    if (isPlainObject(value) && 'value' in value) {
        return flattenJoinValues(value.value, localeCodes, defaultLocale);
    }
    if (isPlainObject(value)) {
        const localeValue = pickLocaleWrapperValue(value, localeCodes, defaultLocale);
        return localeValue !== undefined
            ? flattenJoinValues(localeValue, localeCodes, defaultLocale)
            : Object.values(value).flatMap((item) => flattenJoinValues(item, localeCodes, defaultLocale));
    }
    return value === null || value === undefined ? [] : [value];
};
const resolveJoinFields = async (adapter, collection, docs, depth, joins) => {
    if (!docs.length) {
        return;
    }
    const joinFields = collectJoinFields(getCollectionConfig(adapter, collection)?.fields);
    const parentIDs = docs.map((doc) => doc.id).filter((id) => id !== null && id !== undefined);
    const localeCodes = getLocaleCodes(adapter);
    const defaultLocale = getDefaultLocale(adapter);
    for (const field of joinFields) {
        if (!field.name || !field.collection || !field.on || !parentIDs.length) {
            continue;
        }
        const joinOptions = joins?.[field.name] ?? undefined;
        if (joinOptions === false) {
            continue;
        }
        const limit = joinOptions?.limit ?? field.limit ?? field.defaultLimit ?? 10;
        const page = Math.max(1, Number(joinOptions && 'page' in joinOptions ? joinOptions.page : 1) || 1);
        const start = limit > 0 ? (page - 1) * limit : 0;
        const collections = Array.isArray(field.collection) ? field.collection : [field.collection];
        const joinWhere = joinOptions && 'where' in joinOptions ? joinOptions.where : field.where;
        const sort = getSortSQL(joinOptions?.sort ?? field.sort ?? field.defaultSort);
        const byParent = new Map();
        for (const targetCollection of collections) {
            if (!targetCollection) {
                continue;
            }
            const targetTable = escapeIdent(targetCollection.replaceAll('-', '_'));
            const collectionWhere = filterJoinWhereForCollection(joinWhere, targetCollection);
            const whereSQL = buildWhere(collectionWhere, getCollectionConfig(adapter, targetCollection)?.fields);
            const targetDocs = normalizeFetchedDocs(await adapter.client.query(`SELECT * FROM ${targetTable} ${whereSQL} ${sort};`));
            const populatedTargets = depth > 0 ? await transformRelationshipReads(adapter, targetCollection, targetDocs, depth - 1) : targetDocs;
            for (const [index, targetDoc] of targetDocs.entries()) {
                const foreignValue = getValueAtPath(targetDoc, field.on, localeCodes, defaultLocale);
                const ids = flattenJoinValues(foreignValue, localeCodes, defaultLocale);
                const joinedDoc = Array.isArray(field.collection)
                    ? {
                        relationTo: targetCollection,
                        value: depth > 0 ? populatedTargets[index] : populatedTargets[index]?.id,
                    }
                    : populatedTargets[index];
                for (const id of ids) {
                    const key = String(id);
                    byParent.set(key, [...(byParent.get(key) ?? []), joinedDoc]);
                }
            }
        }
        for (const doc of docs) {
            const joined = sortJoinDocs(byParent.get(String(doc.id)) ?? [], joinOptions?.sort ?? field.sort ?? field.defaultSort);
            const pageDocs = limit > 0 ? joined.slice(start, start + limit) : joined;
            const exposedDocs = field.orderable ? pageDocs.map((pageDoc) => pageDoc.id) : pageDocs;
            const value = field.hasMany === false
                ? (exposedDocs[0] ?? null)
                : {
                    docs: exposedDocs,
                    hasNextPage: limit > 0 ? page * limit < joined.length : false,
                    hasPrevPage: page > 1,
                    limit,
                    page,
                    pagingCounter: joined.length > 0 ? start + 1 : 0,
                    totalDocs: joined.length,
                    totalPages: limit > 0 ? Math.ceil(joined.length / limit) : 1,
                };
            setValueAtPath(doc, field.name, value);
        }
    }
};
export const transformRelationshipReads = async (adapter, collection, docs, depth = 0, joins) => {
    await populateRelationshipFields(adapter, collection, docs, depth);
    await resolveJoinFields(adapter, collection, docs, depth, joins);
    const baseCollection = getVersionBaseCollection(adapter, collection);
    const versionDocs = baseCollection
        ? docs.map((doc) => doc.version).filter(isPlainObject)
        : [];
    if (baseCollection && versionDocs.length) {
        await populateRelationshipFields(adapter, baseCollection, versionDocs, depth);
        await resolveJoinFields(adapter, baseCollection, versionDocs, depth, joins);
    }
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
        if (key !== rootField || !field || !isRelationshipField(field) || !isPlainObject(value)) {
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
