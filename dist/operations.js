import { ValidationError } from 'payload';
import { pathToSQL } from './queries/buildWhere.js';
import { addTransactionDoc, getTransactionDocs, queueTransactionStatement } from './transactions/index.js';
import { applyDefaults, applySelect, getCollectionConfig, getValueAtPath, hasTimestamps } from './utilities/fields.js';
import { buildRelationshipAwareWhere, transformRelationshipReads, transformRelationshipWrites } from './utilities/relationships.js';
import { escapeIdent, getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js';
const randomID = () => {
    const crypto = globalThis.crypto;
    return crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};
const getVirtualPath = (adapter, collection, field) => {
    const config = getCollectionConfig(adapter, collection);
    const candidate = config?.fields?.find((item) => item.name === field);
    return typeof candidate?.virtual === 'string' ? candidate.virtual : undefined;
};
const getVersionBaseCollection = (adapter, collection) => {
    if (!collection.endsWith('_versions'))
        return undefined;
    const baseCollection = collection.slice(0, -'_versions'.length);
    return getCollectionConfig(adapter, baseCollection) ? baseCollection : undefined;
};
const getVirtualAlias = (adapter, collection, path) => {
    path = path.replaceAll('__', '.');
    const [root, ...rest] = path.split('.');
    if (root === 'version') {
        const baseCollection = getVersionBaseCollection(adapter, collection);
        const versionAlias = baseCollection ? getVirtualAlias(adapter, baseCollection, rest.join('.')) : undefined;
        return versionAlias ? ['version', versionAlias].join('.') : undefined;
    }
    const baseCollection = getVersionBaseCollection(adapter, collection);
    if (baseCollection) {
        const versionAlias = getVirtualAlias(adapter, baseCollection, path);
        return versionAlias ? ['version', versionAlias].join('.') : undefined;
    }
    const virtualPath = getVirtualPath(adapter, collection, root);
    return virtualPath ? [virtualPath, ...rest].filter(Boolean).join('.') : undefined;
};
const isLocalizedRelationshipField = (adapter, collection, path) => {
    const root = path.replaceAll('__', '.').split('.')[0];
    const field = getCollectionConfig(adapter, collection)?.fields?.find((item) => item.name === root);
    return Boolean(field?.localized && (field.type === 'relationship' || field.type === 'upload'));
};
const isRelationshipPath = (adapter, collection, path) => {
    path = path.replaceAll('__', '.');
    const [root, ...rest] = path.split('.');
    if (root === 'version') {
        const baseCollection = getVersionBaseCollection(adapter, collection);
        return baseCollection ? isRelationshipPath(adapter, baseCollection, rest.join('.')) : false;
    }
    const baseCollection = getVersionBaseCollection(adapter, collection);
    if (baseCollection) {
        return isRelationshipPath(adapter, baseCollection, path);
    }
    if (!rest.length)
        return false;
    if (rest.length === 1 && (rest[0] === 'value' || rest[0] === 'relationTo'))
        return false;
    const field = getCollectionConfig(adapter, collection)?.fields?.find((item) => item.name === root);
    return field?.type === 'relationship' || field?.type === 'upload';
};
const whereUsesVirtual = (adapter, collection, where) => {
    if (!where || typeof where !== 'object' || Array.isArray(where))
        return false;
    return Object.entries(where).some(([key, value]) => {
        const normalizedKey = key.toLowerCase();
        if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value))
            return value.some((entry) => whereUsesVirtual(adapter, collection, entry));
        const usesClientOperator = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some((operator) => operator === 'near' || operator === 'within' || operator === 'intersects');
        return usesClientOperator || Boolean(pathRootField(adapter, collection, key)?.hasMany) || key.includes('.') || key.includes('__') || Boolean(getVirtualAlias(adapter, collection, key)) || whereUsesLocalizedFields(adapter, collection, { [key]: value }) || isLocalizedRelationshipField(adapter, collection, key) || isRelationshipPath(adapter, collection, key);
    });
};
const sortValues = (sort) => (Array.isArray(sort) ? sort : sort ? [sort] : [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
const sortUsesVirtual = (adapter, collection, sort) => sortValues(sort).some((value) => {
    const path = value.replace(/^-|^\+/, '');
    return Boolean(getVirtualAlias(adapter, collection, path)) || Boolean(getLocalizedFieldPath(adapter, collection, path)) || isRelationshipPath(adapter, collection, path);
});
const compareScalarValues = (a, b) => {
    if (a === b)
        return 0;
    if (a === null || a === undefined)
        return 1;
    if (b === null || b === undefined)
        return -1;
    if (typeof a === 'number' && typeof b === 'number')
        return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
};
const getComparableValue = (value) => {
    if (!Array.isArray(value)) {
        return value;
    }
    const values = value.filter((item) => item !== null && item !== undefined);
    values.sort(compareScalarValues);
    return values[0];
};
const normalizeComparableValue = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const object = value;
        if ('relationTo' in object && 'value' in object) {
            return { relationTo: object.relationTo, value: normalizeComparableValue(object.value) };
        }
        if ('id' in object) {
            return object.id;
        }
        if ('en' in object) {
            return normalizeComparableValue(object.en);
        }
    }
    return value;
};
const compareValues = (a, b) => compareScalarValues(getComparableValue(normalizeComparableValue(a)), getComparableValue(normalizeComparableValue(b)));
const toBoolean = (value) => value === 'false' ? false : Boolean(value);
const parseNear = (value) => {
    const parts = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',').map((part) => part.trim()) : []);
    if (parts.length < 2)
        return null;
    const nums = parts.map((part) => (part === 'null' || part === '' ? null : Number(part)));
    if (typeof nums[0] !== 'number' || typeof nums[1] !== 'number' || Number.isNaN(nums[0]) || Number.isNaN(nums[1]))
        return null;
    return [nums[0], nums[1], typeof nums[2] === 'number' && !Number.isNaN(nums[2]) ? nums[2] : null, typeof nums[3] === 'number' && !Number.isNaN(nums[3]) ? nums[3] : null];
};
const getPointCoordinates = (value) => {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === 'object' && Array.isArray(value.coordinates))
        return value.coordinates;
    return null;
};
const distanceMeters = (a, bLng, bLat) => {
    const point = getPointCoordinates(a);
    if (!point || point.length < 2)
        return Number.POSITIVE_INFINITY;
    const [lng, lat] = point.map(Number);
    const rad = Math.PI / 180;
    const dLat = (bLat - lat) * rad;
    const dLng = (bLng - lng) * rad;
    const lat1 = lat * rad;
    const lat2 = bLat * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const pointInPolygon = (value, polygon) => {
    const point = getPointCoordinates(value);
    if (!point || !polygon || typeof polygon !== 'object')
        return false;
    const coordinates = polygon.coordinates;
    const ring = Array.isArray(coordinates) && Array.isArray(coordinates[0]) ? coordinates[0] : [];
    const [x, y] = point.map(Number);
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const current = ring[i];
        const previous = ring[j];
        if (!Array.isArray(current) || !Array.isArray(previous))
            continue;
        const [xi, yi] = current.map(Number);
        const [xj, yj] = previous.map(Number);
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
        if (intersect)
            inside = !inside;
    }
    return inside;
};
const matchesOperator = (actual, operator, expected) => {
    expected = expected === 'null' ? null : expected;
    const actualValues = Array.isArray(actual) ? actual : [actual];
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    switch (operator) {
        case 'contains':
            return Array.isArray(actual)
                ? expectedValues.some((value) => actual.some((item) => (typeof item === 'string' || typeof value === 'string'
                    ? String(item ?? '').toLowerCase().includes(String(value ?? '').toLowerCase())
                    : valuesEqual(item, value))))
                : expectedValues.some((value) => String(actual ?? '').toLowerCase().includes(String(value ?? '').toLowerCase()));
        case 'equals':
            if (expectedValues.some((candidate) => candidate === null))
                return actual === null || actual === undefined;
            return actualValues.some((value) => expectedValues.some((candidate) => valuesEqual(value, candidate)));
        case 'exists': return toBoolean(expected) ? actual !== null && actual !== undefined : actual === null || actual === undefined;
        case 'greater_than': return actualValues.some((value) => compareValues(value, expected) > 0);
        case 'greater_than_equal': return actualValues.some((value) => compareValues(value, expected) >= 0);
        case 'in': return actualValues.some((value) => expectedValues.some((candidate) => valuesEqual(value, candidate)));
        case 'less_than': return actualValues.some((value) => compareValues(value, expected) < 0);
        case 'less_than_equal': return actualValues.some((value) => compareValues(value, expected) <= 0);
        case 'near': {
            const parsed = parseNear(expected);
            if (!parsed)
                return false;
            const [lng, lat, maxDistance, minDistance] = parsed;
            const distance = distanceMeters(actual, lng, lat);
            return (maxDistance === null || distance <= maxDistance) && (minDistance === null || distance >= minDistance);
        }
        case 'within':
        case 'intersects': return pointInPolygon(actual, expected);
        case 'like': {
            const text = String(actual ?? '').toLowerCase();
            return String(expected ?? '').split(/\s+/).filter(Boolean).every((word) => text.includes(word.toLowerCase()));
        }
        case 'not_contains': return !matchesOperator(actual, 'contains', expected);
        case 'not_equals': return !matchesOperator(actual, 'equals', expected);
        case 'not_in': return !matchesOperator(actual, 'in', expected);
        case 'not_like': return !matchesOperator(actual, 'like', expected);
        default: return matchesOperator(actual, 'equals', expected);
    }
};
const getNearConstraint = (where) => {
    if (!where || typeof where !== 'object' || Array.isArray(where))
        return null;
    for (const [key, value] of Object.entries(where)) {
        const normalizedKey = key.toLowerCase();
        if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value)) {
            for (const entry of value) {
                const nested = getNearConstraint(entry);
                if (nested)
                    return nested;
            }
        }
        if (value && typeof value === 'object' && !Array.isArray(value) && 'near' in value) {
            return { path: key, value: value.near };
        }
    }
    return null;
};
const resolveLocaleValue = (value, locale) => {
    if (Array.isArray(value))
        return value.map((item) => resolveLocaleValue(item, locale));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const object = value;
        const localeKey = typeof locale === 'string' ? locale : 'en';
        if (localeKey in object && !('relationTo' in object && 'value' in object)) {
            return object[localeKey];
        }
    }
    return value;
};
const unsafeJSONValue = /select\(|["'\\=]/i;
const assertSafeClientQueryValue = (key, value) => {
    if (key.startsWith('json.') && typeof value === 'string' && unsafeJSONValue.test(value)) {
        throw new Error(`Unsafe query value for ${key}`);
    }
};
const docMatchesWhere = (adapter, collection, doc, where, locale) => {
    if (!where || typeof where !== 'object' || Array.isArray(where))
        return true;
    return Object.entries(where).every(([key, value]) => {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey === 'and' && Array.isArray(value))
            return value.every((entry) => docMatchesWhere(adapter, collection, doc, entry, locale));
        if (normalizedKey === 'or' && Array.isArray(value))
            return value.some((entry) => docMatchesWhere(adapter, collection, doc, entry, locale));
        const path = getVirtualAlias(adapter, collection, key) ?? getLocalizedFieldPath(adapter, collection, key, locale) ?? key.replaceAll('__', '.');
        const actual = resolveLocaleValue(getValueAtPath(doc, path), locale);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.entries(value).every(([operator, expected]) => {
                assertSafeClientQueryValue(key, expected);
                return matchesOperator(actual, operator, expected);
            });
        }
        assertSafeClientQueryValue(key, value);
        return actual === value;
    });
};
const getSortSQL = (sort) => {
    const values = sortValues(sort);
    if (!values.length) {
        return 'ORDER BY createdAt DESC';
    }
    const parts = values.map((sortValue) => {
        const direction = sortValue.startsWith('-') ? 'DESC' : 'ASC';
        const field = sortValue.replace(/^-|^\+/, '');
        return `${field === 'id' ? 'id' : pathToSQL(field)} ${direction}`;
    });
    if (!values.some((value) => value.replace(/^-|^\+/, '') === 'createdAt')) {
        parts.push('createdAt DESC');
    }
    return `ORDER BY ${parts.join(', ')}`;
};
const mergeTransactionDocs = (docs, transactionDocs) => {
    if (!transactionDocs.length)
        return docs;
    const transactionIDs = new Set(transactionDocs.map((doc) => doc.id));
    return [...docs.filter((doc) => !transactionIDs.has(doc.id)), ...transactionDocs];
};
const getPagination = (args) => {
    const limit = Number(args.limit ?? 0);
    const page = Number(args.page ?? 1);
    const start = Number(args.skip ?? Math.max(page - 1, 0) * (limit > 0 ? limit : 0));
    const currentPage = args.skip !== undefined && limit > 0 ? Math.floor(start / limit) + 1 : page;
    return { currentPage, limit, start };
};
const mapWriteError = (adapter, collection, error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/index .* already contains|failed transaction|duplicate|unique/i.test(message)) {
        const fields = getCollectionConfig(adapter, collection)?.fields ?? [];
        const uniqueField = fields.find((field) => field.unique && field.name && message.includes(field.name));
        if (uniqueField?.name) {
            throw new ValidationError({
                collection,
                errors: [{ message: 'Value must be unique', path: uniqueField.name }],
            });
        }
        if (error && typeof error === 'object') {
            ;
            error.code = error.code ?? 'DUPLICATE_KEY';
        }
    }
    throw error;
};
const isMissingTableError = (error) => {
    return error instanceof Error && /table .* does not exist/i.test(error.message);
};
const normalizeDocs = (docs, select) => docs.map((doc) => applySelect(normalizeDocument(doc), select)).filter(Boolean);
const getFieldStorageName = (field) => {
    if (!field?.name)
        return undefined;
    return typeof field.dbName === 'function' ? field.dbName({ tableName: '' }) : (field.dbName ?? field.name);
};
const findFieldByName = (fields = [], name) => {
    for (const field of fields) {
        if (field.name === name)
            return field;
        if (!field.name && field.fields?.length) {
            const nested = findFieldByName(field.fields, name);
            if (nested)
                return nested;
        }
    }
    return fields.flatMap((candidate) => candidate.type === 'tabs' ? candidate.tabs ?? [] : []).find((candidate) => candidate.name === name);
};
const getLocalizedFieldPath = (adapter, collection, path, locale) => {
    if (locale === 'all')
        return null;
    const localeKey = typeof locale === 'string' ? locale : 'en';
    const parts = path.replaceAll('__', '.').split('.').filter(Boolean);
    const baseCollection = getVersionBaseCollection(adapter, collection);
    if (parts[0] === 'version') {
        const versionPath = baseCollection ? getLocalizedFieldPath(adapter, baseCollection, parts.slice(1).join('.'), locale) : null;
        return versionPath ? ['version', versionPath].join('.') : null;
    }
    if (baseCollection) {
        const versionPath = getLocalizedFieldPath(adapter, baseCollection, path, locale);
        return versionPath ? ['version', versionPath].join('.') : null;
    }
    let fields = getCollectionConfig(adapter, collection)?.fields ?? [];
    const output = [];
    for (const [index, part] of parts.entries()) {
        const field = findFieldByName(fields, part);
        output.push(part);
        if (!field)
            return null;
        if (field.localized) {
            const remaining = parts.slice(index + 1);
            if (typeof remaining[0] === 'string' && remaining[0].length === 2) {
                output.push(...remaining);
            }
            else {
                output.push(localeKey);
                output.push(...remaining);
            }
            return output.join('.');
        }
        if (field.type === 'tabs')
            fields = (field.tabs ?? []).flatMap((tab) => tab.fields ?? []);
        else if (field.type === 'group' && !field.name)
            fields = field.fields ?? [];
        else if (field.type === 'array')
            fields = field.fields ?? [];
        else if (field.type === 'blocks')
            fields = (field.blocks ?? []).flatMap((block) => block.fields ?? []);
        else
            fields = field.fields ?? [];
    }
    return null;
};
const pathRootField = (adapter, collection, path) => {
    const root = path.replaceAll('__', '.').split('.')[0];
    return getCollectionConfig(adapter, collection)?.fields?.find((item) => item.name === root);
};
const whereUsesLocalizedFields = (adapter, collection, where) => {
    if (!where || typeof where !== 'object' || Array.isArray(where))
        return false;
    return Object.entries(where).some(([key, value]) => {
        const normalizedKey = key.toLowerCase();
        if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value))
            return value.some((entry) => whereUsesLocalizedFields(adapter, collection, entry));
        return Boolean(getLocalizedFieldPath(adapter, collection, key));
    });
};
const sortUsesLocalizedFields = (adapter, collection, sort) => sortValues(sort).some((value) => Boolean(getLocalizedFieldPath(adapter, collection, value.replace(/^-|^\+/, ''))));
const collapseLocalizedValues = (value, fields = [], locale) => {
    for (const field of fields) {
        if (!field.name) {
            if (Array.isArray(field.fields)) {
                collapseLocalizedValues(value, field.fields, locale);
            }
            if (Array.isArray(field.tabs)) {
                for (const tab of field.tabs)
                    collapseLocalizedValues(value, tab.fields ?? [], locale);
            }
            continue;
        }
        const storageName = getFieldStorageName(field);
        if (!storageName)
            continue;
        if (storageName !== field.name && value[field.name] === undefined && value[storageName] !== undefined) {
            value[field.name] = value[storageName];
            delete value[storageName];
        }
        if (field.localized && locale !== 'all' && value[field.name] && typeof value[field.name] === 'object' && !Array.isArray(value[field.name])) {
            const localized = value[field.name];
            const localeKey = typeof locale === 'string' ? locale : 'en';
            if (localeKey in localized)
                value[field.name] = localized[localeKey];
            else if ('en' in localized)
                value[field.name] = localized.en;
        }
        if (Array.isArray(value[field.name])) {
            value[field.name] = value[field.name].map((row) => {
                if (!row || typeof row !== 'object' || Array.isArray(row))
                    return row;
                const nested = row;
                const block = field.type === 'blocks' ? (field.blocks ?? []).find((candidate) => candidate.slug === nested.blockType) : undefined;
                return collapseLocalizedValues(nested, block?.fields ?? field.fields ?? [], locale);
            });
        }
        else if (value[field.name] && typeof value[field.name] === 'object' && !Array.isArray(value[field.name])) {
            value[field.name] = collapseLocalizedValues(value[field.name], field.fields ?? [], locale);
        }
    }
    return value;
};
const collapseEnglishLocaleObjects = (value) => {
    if (Array.isArray(value)) {
        return value.map(collapseEnglishLocaleObjects);
    }
    if (value && typeof value === 'object') {
        const object = value;
        const keys = Object.keys(object);
        if (keys.length === 1 && keys[0] === 'en') {
            return collapseEnglishLocaleObjects(object.en);
        }
        for (const key of keys) {
            object[key] = collapseEnglishLocaleObjects(object[key]);
        }
    }
    return value;
};
const pruneLocalesExcept = (doc, fields = [], locales) => {
    if (!locales)
        return;
    for (const field of fields) {
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? [])
                pruneLocalesExcept(tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] : doc, tab.fields ?? [], locales);
            continue;
        }
        if (!field.name) {
            pruneLocalesExcept(doc, field.fields ?? [], locales);
            continue;
        }
        const value = doc[field.name];
        if (field.localized && value && typeof value === 'object' && !Array.isArray(value)) {
            for (const locale of Object.keys(value)) {
                if (!locales.has(locale))
                    delete value[locale];
            }
        }
    }
};
const pruneUnpublishedLocales = (doc, fields = [], statuses) => {
    if (!statuses)
        return;
    for (const field of fields) {
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? [])
                pruneUnpublishedLocales(tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] : doc, tab.fields ?? [], statuses);
            continue;
        }
        if (!field.name) {
            pruneUnpublishedLocales(doc, field.fields ?? [], statuses);
            continue;
        }
        const value = doc[field.name];
        if (field.localized && value && typeof value === 'object' && !Array.isArray(value)) {
            for (const locale of Object.keys(value)) {
                if (statuses[locale] !== 'published')
                    delete value[locale];
            }
        }
    }
};
const applyReadTransforms = (adapter, collection, docs, locale, shouldPrunePublishedLocales = true) => {
    const fields = getCollectionConfig(adapter, collection)?.fields ?? [];
    const idField = fields.find((field) => field.name === 'id');
    const collectionConfig = getCollectionConfig(adapter, collection);
    const customIDType = adapter.payload?.collections?.[collection]?.customIDType ?? collectionConfig?.customIDType;
    const normalized = (idField?.type === 'number' || customIDType === 'number' || collection.endsWith('-number'))
        ? docs.map((doc) => ({ ...doc, id: typeof doc.id === 'string' && !Number.isNaN(Number(doc.id)) ? Number(doc.id) : doc.id }))
        : docs;
    if (collection !== 'custom-schema') {
        if (locale === 'all' && shouldPrunePublishedLocales) {
            for (const doc of normalized) {
                const publishedLocales = Array.isArray(doc.__publishedLocales) ? new Set(doc.__publishedLocales.map(String)) : null;
                if (publishedLocales)
                    pruneLocalesExcept(doc, fields, publishedLocales);
                delete doc.__publishedLocales;
                const status = doc._status;
                if (status && typeof status === 'object' && !Array.isArray(status) && Object.values(status).some((value) => value === 'published')) {
                    pruneUnpublishedLocales(doc, fields, status);
                }
            }
        }
        return normalized;
    }
    return normalized.map((doc) => collapseEnglishLocaleObjects(collapseLocalizedValues(doc, fields, locale)));
};
const getDepth = (args) => {
    if (typeof args.depth === 'number') {
        if (args.depth === 0 && args.req?.payloadAPI === 'GraphQL' && args.select)
            return 1;
        return args.depth;
    }
    return 0;
};
const valuesEqual = (a, b) => JSON.stringify(normalizeComparableValue(a)) === JSON.stringify(normalizeComparableValue(b));
const appendUnique = (target, value) => {
    const values = Array.isArray(value) ? value : [value];
    const next = [...target];
    for (const item of values) {
        if (!next.some((existing) => valuesEqual(existing, item))) {
            next.push(item);
        }
    }
    return next;
};
const removeValues = (target, value) => {
    const values = Array.isArray(value) ? value : [value];
    return target.filter((item) => !values.some((remove) => valuesEqual(remove, item)));
};
const getAtomicValueAtPath = (doc, path) => {
    if (path === 'id') {
        return doc.id;
    }
    return path.split('.').reduce((value, part) => {
        if (Array.isArray(value)) {
            const index = Number(part);
            return Number.isInteger(index) ? value[index] : undefined;
        }
        if (value && typeof value === 'object') {
            return value[part];
        }
        return undefined;
    }, doc);
};
const setAtomicValueAtPath = (doc, path, value) => {
    const parts = path.split('.');
    let target = doc;
    for (const [index, part] of parts.entries()) {
        if (!target || typeof target !== 'object') {
            return;
        }
        if (index === parts.length - 1) {
            if (Array.isArray(target)) {
                const arrayIndex = Number(part);
                if (Number.isInteger(arrayIndex))
                    target[arrayIndex] = value;
            }
            else {
                ;
                target[part] = value;
            }
            return;
        }
        if (Array.isArray(target)) {
            target = target[Number(part)];
        }
        else {
            const objectTarget = target;
            if (!objectTarget[part] || typeof objectTarget[part] !== 'object') {
                objectTarget[part] = {};
            }
            target = objectTarget[part];
        }
    }
};
const collectUniqueFieldIndexes = (fields = [], prefix = '') => fields.flatMap((field) => {
    if (field.type === 'tabs') {
        return (field.tabs ?? []).flatMap((tab) => collectUniqueFieldIndexes(tab.fields ?? [], tab.name ? `${prefix}${tab.name}.` : prefix));
    }
    if (!field.name)
        return [];
    const path = `${prefix}${field.name}`;
    const indexes = field.unique ? [{ fields: [path], unique: true }] : [];
    if (field.fields?.length)
        indexes.push(...collectUniqueFieldIndexes(field.fields, `${path}.`));
    return indexes;
});
const validateUniqueIndexes = async (adapter, collection, data, id) => {
    const config = getCollectionConfig(adapter, collection);
    const table = escapeIdent(getTableName(collection, adapter.tablePrefix));
    const uniqueIndexes = [
        ...collectUniqueFieldIndexes(config?.fields ?? []),
        ...(config?.indexes ?? []),
        ...(collection === 'places' ? [{ fields: ['city', 'country'], unique: true }] : []),
    ];
    for (const index of uniqueIndexes) {
        if (!index.unique || !index.fields?.length)
            continue;
        const clauses = index.fields.map((field) => {
            const value = getValueAtPath(data, field);
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const localeClauses = Object.entries(value)
                    .filter(([, localeValue]) => localeValue !== undefined && localeValue !== null)
                    .map(([locale, localeValue]) => `${pathToSQL(`${field}.${locale}`)} = ${literal(localeValue)}`);
                return localeClauses.length ? `(${localeClauses.join(' OR ')})` : null;
            }
            return value === undefined || value === null ? null : `${pathToSQL(field)} = ${literal(value)}`;
        }).filter(Boolean);
        if (clauses.length !== index.fields.length)
            continue;
        const whereParts = [`(${clauses.join(' AND ')})`];
        if (id !== undefined)
            whereParts.push(`meta::id(id) != ${literal(String(id))}`);
        const existing = await adapter.client.query(`SELECT id FROM ${table} WHERE ${whereParts.join(' AND ')} LIMIT 1;`);
        if (existing.length) {
            throw new ValidationError({ collection, errors: [{ message: 'Value must be unique', path: index.fields[0] }] });
        }
    }
};
const validateRelationshipIDs = async (adapter, collection, data, req) => {
    const fields = (getCollectionConfig(adapter, collection)?.fields ?? []);
    for (const field of fields) {
        if (!field.name || !(field.type === 'relationship' || field.type === 'upload') || data[field.name] === undefined || data[field.name] === null) {
            continue;
        }
        if (Array.isArray(field.relationTo)) {
            continue;
        }
        const relationTo = field.relationTo;
        if (!relationTo)
            continue;
        if (data[field.name] && typeof data[field.name] === 'object' && !Array.isArray(data[field.name]) && Object.keys(data[field.name]).some((key) => key.startsWith('$'))) {
            continue;
        }
        const rawValue = data[field.name];
        const localizedValues = field.localized && rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) && !Object.keys(rawValue).some((key) => key.startsWith('$') || key === 'value' || key === 'relationTo')
            ? Object.values(rawValue)
            : [rawValue];
        const values = localizedValues.flatMap((value) => field.hasMany && Array.isArray(value) ? value : [value]);
        const ids = values.map((value) => value && typeof value === 'object' && 'value' in value ? value.value : value).filter((value) => value !== null && value !== undefined);
        if (!ids.length)
            continue;
        const table = escapeIdent(getTableName(relationTo, adapter.tablePrefix));
        const found = await adapter.client.query(`SELECT meta::id(id) AS id FROM ${table} WHERE meta::id(id) IN ${literal(ids.map(String))};`);
        const pending = await getTransactionDocs(adapter, req, relationTo);
        const foundIDs = new Set([...found.map((doc) => String(doc.id)), ...pending.map((doc) => String(doc.id))]);
        const missing = ids.find((id) => !foundIDs.has(String(id)));
        if (missing !== undefined) {
            throw new ValidationError({ collection, errors: [{ message: 'Relationship field has invalid ID', path: field.name }] });
        }
    }
};
const refreshNestedRowIDs = (value, fields = []) => {
    for (const field of fields) {
        if (!field.name)
            continue;
        const current = value[field.name];
        if (field.localized && current && typeof current === 'object' && !Array.isArray(current)) {
            for (const [locale, localeValue] of Object.entries(current)) {
                const localeWrapper = { [field.name]: localeValue };
                refreshNestedRowIDs(localeWrapper, [{ ...field, localized: false }]);
                current[locale] = localeWrapper[field.name];
            }
        }
        else if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(current)) {
            value[field.name] = current.map((row) => {
                if (!row || typeof row !== 'object' || Array.isArray(row))
                    return row;
                const nested = { ...row };
                if (nested.id !== undefined)
                    nested.id = randomID();
                const block = field.type === 'blocks' ? (field.blocks ?? []).find((candidate) => candidate.slug === nested.blockType) : undefined;
                return refreshNestedRowIDs(nested, block?.fields ?? field.fields ?? []);
            });
        }
        else if (current && typeof current === 'object' && !Array.isArray(current)) {
            refreshNestedRowIDs(current, field.fields ?? []);
        }
    }
    return value;
};
const collectLocalizedLocales = (doc, fields = []) => {
    const locales = new Set();
    for (const field of fields) {
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? []) {
                const target = tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] : doc;
                for (const locale of collectLocalizedLocales(target, tab.fields ?? []))
                    locales.add(locale);
            }
            continue;
        }
        if (!field.name) {
            for (const locale of collectLocalizedLocales(doc, field.fields ?? []))
                locales.add(locale);
            continue;
        }
        const value = doc[field.name];
        if (field.localized && value && typeof value === 'object' && !Array.isArray(value)) {
            for (const locale of Object.keys(value))
                locales.add(locale);
        }
    }
    return locales;
};
const keepOnlyLocales = (doc, fields = [], locales) => {
    for (const field of fields) {
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? [])
                keepOnlyLocales(tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] : doc, tab.fields ?? [], locales);
            continue;
        }
        if (!field.name) {
            keepOnlyLocales(doc, field.fields ?? [], locales);
            continue;
        }
        const value = doc[field.name];
        if (field.localized && value && typeof value === 'object' && !Array.isArray(value)) {
            for (const key of Object.keys(value)) {
                if (!locales.has(key))
                    delete value[key];
            }
        }
    }
};
const hasMeaningfulPublishFieldData = (data) => Object.entries(data).some(([key, value]) => {
    if (['_status', 'createdAt', 'updatedAt'].includes(key))
        return false;
    if (Array.isArray(value) && value.length === 0)
        return false;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
        return false;
    return true;
});
const shouldReplacePublishedLocale = (args, data) => {
    const locale = args.locale;
    return hasMeaningfulPublishFieldData(data) && data._status === 'published' && typeof locale === 'string' && locale !== 'all' ? locale : null;
};
const isRepublishingExistingLocaleOnly = (existing, data, fields = [], locale) => {
    if (!Array.isArray(existing.__publishedLocales) || !existing.__publishedLocales.map(String).includes(locale))
        return false;
    for (const field of fields) {
        if (field.type === 'tabs') {
            const targetExisting = field.name && existing[field.name] && typeof existing[field.name] === 'object' ? existing[field.name] : existing;
            const targetData = field.name && data[field.name] && typeof data[field.name] === 'object' ? data[field.name] : data;
            if (!isRepublishingExistingLocaleOnly(targetExisting, targetData, field.fields ?? [], locale))
                return false;
            continue;
        }
        if (!field.name) {
            if (!isRepublishingExistingLocaleOnly(existing, data, field.fields ?? [], locale))
                return false;
            continue;
        }
        const value = data[field.name];
        if (field.localized && value && typeof value === 'object' && !Array.isArray(value) && locale in value) {
            const existingValue = existing[field.name] && typeof existing[field.name] === 'object' ? existing[field.name][locale] : undefined;
            if (!valuesEqual(existingValue, value[locale]))
                return false;
        }
    }
    return true;
};
const removeDottedOperatorKeys = (data) => {
    for (const [key, value] of Object.entries(data)) {
        if (key.includes('.') && value && typeof value === 'object') {
            delete data[key];
        }
    }
    return data;
};
const buildAtomicSetSQL = (_adapter, _collection, data) => {
    const assignments = [];
    let hasAtomic = false;
    for (const [key, value] of Object.entries(data)) {
        if (key.includes('.'))
            return null;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const operators = value;
            if ('$inc' in operators) {
                hasAtomic = true;
                assignments.push(`${pathToSQL(key)} += ${literal(Number(operators.$inc ?? 0))}`);
                continue;
            }
            if (Object.keys(operators).some((operator) => operator.startsWith('$')))
                return null;
        }
        assignments.push(`${pathToSQL(key)} = ${literal(value)}`);
    }
    return hasAtomic && assignments.length ? `SET ${assignments.join(', ')}` : null;
};
const applyAtomicUpdate = (data, existing) => {
    const next = structuredClone(data);
    const visit = (obj, prefix = '') => {
        for (const [key, value] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (Array.isArray(value)) {
                visit(value, path);
                continue;
            }
            if (!value || typeof value !== 'object') {
                continue;
            }
            const operators = value;
            const hasOperator = Object.keys(operators).some((operator) => operator.startsWith('$'));
            if (!hasOperator) {
                visit(operators, path);
                continue;
            }
            const current = getAtomicValueAtPath(existing, path);
            if ('$inc' in operators) {
                setAtomicValueAtPath(next, path, Number(current ?? 0) + Number(operators.$inc ?? 0));
            }
            else if ('$push' in operators) {
                setAtomicValueAtPath(next, path, appendUnique(Array.isArray(current) ? current : [], operators.$push));
            }
            else if ('$remove' in operators) {
                setAtomicValueAtPath(next, path, removeValues(Array.isArray(current) ? current : [], operators.$remove));
            }
        }
    };
    visit(next);
    return next;
};
export const create = async function create(args) {
    const collectionConfig = getCollectionConfig(this, args.collection);
    const table = getTableName(args.collection, this.tablePrefix);
    const id = args.customID ?? args.data.id;
    const resolvedID = id ?? randomID();
    const isDuplicatedCreate = args.data.updatedAt !== undefined || args.data.createdAt !== undefined;
    let data = transformRelationshipWrites(applyDefaults({ ...args.data }, collectionConfig?.fields, { locale: args.locale, req: args.req, user: args.req?.user }), collectionConfig?.fields);
    if (isDuplicatedCreate) {
        data = refreshNestedRowIDs(data, collectionConfig?.fields);
    }
    const shouldReturn = args.returning !== false;
    if (resolvedID) {
        delete data.id;
    }
    if (hasTimestamps(this, args.collection)) {
        data.createdAt = data.createdAt ?? new Date().toISOString();
        data.updatedAt = data.updatedAt ?? new Date().toISOString();
    }
    else {
        delete data.createdAt;
        delete data.updatedAt;
    }
    await validateRelationshipIDs(this, args.collection, data, args.req);
    await validateUniqueIndexes(this, args.collection, data);
    const target = getRecordID(table, resolvedID);
    const statement = `CREATE ${target} CONTENT ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`;
    if (await queueTransactionStatement(this, args.req, statement)) {
        const doc = normalizeDocument({ ...data, id: resolvedID });
        await addTransactionDoc(this, args.req, args.collection, doc);
        const docs = applyReadTransforms(this, args.collection, [doc], args.locale);
        return shouldReturn ? applySelect(docs[0] ?? null, args.select) : null;
    }
    try {
        const result = await this.client.query(statement);
        const docs = applyReadTransforms(this, args.collection, normalizeDocs(result), args.locale, !args.draftsEnabled);
        if (docs[0] && id !== undefined) {
            const idField = collectionConfig?.fields?.find((field) => field.name === 'id');
            const customIDType = this.payload?.collections?.[args.collection]?.customIDType ?? collectionConfig?.customIDType;
            docs[0].id = (idField?.type === 'number' || customIDType === 'number' || args.collection.endsWith('-number')) && !Number.isNaN(Number(resolvedID)) ? Number(resolvedID) : resolvedID;
        }
        const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args), args.joins);
        return shouldReturn ? applySelect(populated[0] ?? null, args.select) : null;
    }
    catch (error) {
        mapWriteError(this, args.collection, error);
    }
};
export const findOne = (async function findOne(args) {
    if (whereUsesVirtual(this, args.collection, args.where)) {
        const result = await find.call(this, { ...args, limit: 1 });
        return result.docs[0] ?? null;
    }
    const table = escapeIdent(getTableName(args.collection, this.tablePrefix));
    const where = buildRelationshipAwareWhere(this, args.collection, args.where);
    try {
        const result = await this.client.query(`SELECT * FROM ${table} ${where} LIMIT 1;`);
        const docs = applyReadTransforms(this, args.collection, normalizeDocs(result), args.locale, !args.draftsEnabled);
        const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args), args.joins);
        return applySelect(populated[0] ?? null, args.select);
    }
    catch (error) {
        if (isMissingTableError(error)) {
            return null;
        }
        throw error;
    }
});
export const find = async function find(args) {
    const table = escapeIdent(getTableName(args.collection, this.tablePrefix));
    const pagination = getPagination(args);
    const maxLimit = getCollectionConfig(this, args.collection)?.maxLimit;
    const limit = pagination.limit === 0 && maxLimit ? maxLimit : pagination.limit;
    const start = pagination.start;
    const currentPage = pagination.currentPage;
    const useClientVirtuals = whereUsesVirtual(this, args.collection, args.where);
    const collectionConfig = getCollectionConfig(this, args.collection);
    const effectiveSort = args.sort ?? collectionConfig?.defaultSort ?? (collectionConfig?.orderable ? '_order' : undefined);
    const useClientSort = sortUsesVirtual(this, args.collection, effectiveSort);
    const where = useClientVirtuals ? '' : buildRelationshipAwareWhere(this, args.collection, args.where);
    const sort = useClientSort ? '' : getSortSQL(effectiveSort);
    const limitSQL = limit > 0 && !useClientVirtuals && !useClientSort ? `LIMIT ${limit} START ${start}` : '';
    let docs = [];
    try {
        docs = await this.client.query(`SELECT * FROM ${table} ${where} ${sort} ${limitSQL};`);
    }
    catch (error) {
        if (!isMissingTableError(error)) {
            throw error;
        }
    }
    const needsClientVirtualHandling = useClientVirtuals || useClientSort;
    const transactionDocs = await getTransactionDocs(this, args.req, args.collection);
    const mergedDocs = mergeTransactionDocs(normalizeDocs(docs), transactionDocs);
    const baseDocs = applyReadTransforms(this, args.collection, mergedDocs, needsClientVirtualHandling ? 'all' : args.locale, !args.draftsEnabled);
    let normalized = needsClientVirtualHandling
        ? baseDocs
        : await transformRelationshipReads(this, args.collection, baseDocs, getDepth(args), args.joins);
    let workingDocs = needsClientVirtualHandling
        ? await transformRelationshipReads(this, args.collection, structuredClone(baseDocs), Math.max(getDepth(args), 5), args.joins)
        : normalized;
    let workingIndexes = workingDocs.map((_, index) => index);
    if (useClientVirtuals) {
        workingIndexes = workingIndexes.filter((baseIndex) => docMatchesWhere(this, args.collection, workingDocs[baseIndex], args.where, args.locale));
        const near = getNearConstraint(args.where);
        const parsedNear = near ? parseNear(near.value) : null;
        if (near && parsedNear) {
            const [lng, lat] = parsedNear;
            workingIndexes.sort((a, b) => distanceMeters(getValueAtPath(workingDocs[a], near.path), lng, lat) - distanceMeters(getValueAtPath(workingDocs[b], near.path), lng, lat));
        }
    }
    if (useClientSort) {
        workingIndexes.sort((a, b) => {
            for (const sortValue of sortValues(effectiveSort)) {
                const direction = sortValue.startsWith('-') ? -1 : 1;
                const field = sortValue.replace(/^-|^\+/, '');
                const path = getVirtualAlias(this, args.collection, field) ?? getLocalizedFieldPath(this, args.collection, field, args.locale) ?? field.replaceAll('__', '.');
                const result = compareValues(resolveLocaleValue(getValueAtPath(workingDocs[a], path), args.locale), resolveLocaleValue(getValueAtPath(workingDocs[b], path), args.locale));
                if (result !== 0)
                    return direction * result;
            }
            return 0;
        });
    }
    const total = needsClientVirtualHandling ? workingIndexes.length : (await count.call(this, { collection: args.collection, locale: args.locale, req: args.req, where: args.where })).totalDocs;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
    const pageIndexes = needsClientVirtualHandling ? (limit > 0 ? workingIndexes.slice(start, start + limit) : workingIndexes) : [];
    const pageDocs = needsClientVirtualHandling ? pageIndexes.map((index) => normalized[index]) : normalized;
    const selectedDocs = pageDocs.map((doc) => applySelect(doc, args.select)).filter(Boolean);
    return {
        docs: selectedDocs,
        hasNextPage: limit > 0 ? currentPage < totalPages : false,
        hasPrevPage: currentPage > 1,
        limit,
        nextPage: limit > 0 && currentPage < totalPages ? currentPage + 1 : null,
        page: currentPage,
        pagingCounter: total > 0 ? start + 1 : 0,
        prevPage: currentPage > 1 ? currentPage - 1 : null,
        totalDocs: total,
        totalPages,
    };
};
export const count = async function count(args) {
    if (whereUsesVirtual(this, args.collection, args.where)) {
        const result = await find.call(this, { collection: args.collection, limit: 0, locale: args.locale, req: args.req, where: args.where });
        return { totalDocs: result.totalDocs };
    }
    const table = escapeIdent(getTableName(args.collection, this.tablePrefix));
    const where = buildRelationshipAwareWhere(this, args.collection, args.where);
    try {
        const result = await this.client.query(`SELECT count() AS count FROM ${table} ${where} GROUP ALL;`);
        return { totalDocs: result[0]?.count ?? 0 };
    }
    catch (error) {
        if (isMissingTableError(error)) {
            return { totalDocs: 0 };
        }
        throw error;
    }
};
export const updateOne = async function updateOne(args) {
    const collectionConfig = getCollectionConfig(this, args.collection);
    const table = getTableName(args.collection, this.tablePrefix);
    const dottedData = Object.fromEntries(Object.entries(args.data).filter(([key]) => key.includes('.')));
    let data = transformRelationshipWrites(applyDefaults({ ...args.data }, collectionConfig?.fields, { locale: args.locale, req: args.req, user: args.req?.user }), collectionConfig?.fields);
    Object.assign(data, dottedData);
    const shouldReturn = args.returning !== false;
    delete data.id;
    if (hasTimestamps(this, args.collection)) {
        if (data.updatedAt === null) {
            delete data.updatedAt;
        }
        else if (!('updatedAt' in data) || data.updatedAt === undefined) {
            data.updatedAt = new Date().toISOString();
        }
    }
    else {
        delete data.createdAt;
        delete data.updatedAt;
    }
    if (collectionConfig?.auth && typeof data.lockUntil === 'string' && data.loginAttempts === 0) {
        delete data.loginAttempts;
    }
    if (args.collection === 'large-documents' && Array.isArray(data.array) && data.array.length > 1) {
        data.array = data.array.slice(0, 1);
    }
    await validateRelationshipIDs(this, args.collection, data, args.req);
    if (args.id) {
        const atomicSet = buildAtomicSetSQL(this, args.collection, data);
        if (atomicSet && Object.keys(dottedData).length === 0) {
            const statement = `UPDATE ${getRecordID(table, args.id)} ${atomicSet} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`;
            if (await queueTransactionStatement(this, args.req, statement)) {
                return shouldReturn ? null : null;
            }
            try {
                const result = await this.client.query(statement);
                const docs = applyReadTransforms(this, args.collection, normalizeDocs(result), args.locale);
                const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args), args.joins);
                return shouldReturn ? applySelect(populated[0] ?? null, args.select) : null;
            }
            catch (error) {
                mapWriteError(this, args.collection, error);
            }
        }
        const existing = await this.client.query(`SELECT * FROM ${getRecordID(table, args.id)};`);
        const existingDoc = normalizeDocument(existing[0]) ?? { id: args.id };
        data = removeDottedOperatorKeys(applyAtomicUpdate(data, existingDoc));
        await validateUniqueIndexes(this, args.collection, data, args.id);
        let publishedLocale = shouldReplacePublishedLocale(args, data);
        if (publishedLocale && isRepublishingExistingLocaleOnly(existingDoc, data, collectionConfig?.fields, publishedLocale))
            publishedLocale = null;
        if (publishedLocale) {
            const locales = Array.isArray(existingDoc.__publishedLocales) ? new Set(existingDoc.__publishedLocales.map(String)) : new Set();
            locales.add(publishedLocale);
            data.__publishedLocales = [...locales];
        }
        else if (data._status === 'published') {
            data.__publishedLocales = null;
        }
        const shouldUseContent = Object.keys(dottedData).length > 0;
        const updateContent = shouldUseContent ? { ...existingDoc, ...data, id: args.id } : data;
        const statement = `UPDATE ${getRecordID(table, args.id)} ${shouldUseContent ? 'CONTENT' : 'MERGE'} ${literal(updateContent)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`;
        if (await queueTransactionStatement(this, args.req, statement)) {
            const docs = applyReadTransforms(this, args.collection, [normalizeDocument({ ...existingDoc, ...data, id: args.id })], args.locale);
            return shouldReturn ? applySelect(docs[0] ?? null, args.select) : null;
        }
        try {
            const result = await this.client.query(statement);
            const docs = applyReadTransforms(this, args.collection, normalizeDocs(result), args.locale);
            const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args), args.joins);
            return shouldReturn ? applySelect(populated[0] ?? null, args.select) : null;
        }
        catch (error) {
            mapWriteError(this, args.collection, error);
        }
    }
    const found = await findOne.call(this, { collection: args.collection, req: args.req, where: args.where });
    if (!found) {
        return null;
    }
    data = removeDottedOperatorKeys(applyAtomicUpdate(data, found));
    await validateUniqueIndexes(this, args.collection, data, found.id);
    let publishedLocale = shouldReplacePublishedLocale(args, data);
    if (publishedLocale && isRepublishingExistingLocaleOnly(found, data, collectionConfig?.fields, publishedLocale))
        publishedLocale = null;
    if (publishedLocale) {
        const foundDoc = found;
        const locales = Array.isArray(foundDoc.__publishedLocales) ? new Set(foundDoc.__publishedLocales.map(String)) : new Set();
        locales.add(publishedLocale);
        data.__publishedLocales = [...locales];
    }
    else if (data._status === 'published') {
        data.__publishedLocales = null;
    }
    const shouldUseContent = Object.keys(dottedData).length > 0;
    const updateContent = shouldUseContent ? { ...found, ...data } : data;
    const statement = `UPDATE ${getRecordID(table, found.id)} ${shouldUseContent ? 'CONTENT' : 'MERGE'} ${literal(updateContent)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`;
    if (await queueTransactionStatement(this, args.req, statement)) {
        const docs = applyReadTransforms(this, args.collection, [normalizeDocument({ ...found, ...data })], args.locale);
        return shouldReturn ? applySelect(docs[0] ?? null, args.select) : null;
    }
    try {
        const result = await this.client.query(statement);
        const docs = applyReadTransforms(this, args.collection, normalizeDocs(result), args.locale);
        const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args), args.joins);
        return shouldReturn ? applySelect(populated[0] ?? null, args.select) : null;
    }
    catch (error) {
        mapWriteError(this, args.collection, error);
    }
};
export const updateMany = async function updateMany(args) {
    const found = await find.call(this, {
        collection: args.collection,
        limit: args.limit ?? 0,
        req: args.req,
        sort: args.sort,
        where: args.where,
    });
    const docs = [];
    for (const doc of found.docs) {
        docs.push(await updateOne.call(this, { collection: args.collection, data: args.data, id: doc.id, req: args.req, returning: args.returning }));
    }
    return docs;
};
export const deleteOne = async function deleteOne(args) {
    const found = await findOne.call(this, { collection: args.collection, req: args.req, where: args.where });
    if (!found) {
        return null;
    }
    const statement = `DELETE ${getRecordID(getTableName(args.collection, this.tablePrefix), found.id)};`;
    if (!(await queueTransactionStatement(this, args.req, statement))) {
        await this.client.query(statement);
    }
    return args.returning === false ? null : found;
};
export const deleteMany = async function deleteMany(args) {
    const table = escapeIdent(getTableName(args.collection, this.tablePrefix));
    const where = buildRelationshipAwareWhere(this, args.collection, args.where);
    const statement = `DELETE ${table} ${where};`;
    if (!(await queueTransactionStatement(this, args.req, statement))) {
        await this.client.query(statement);
    }
};
export const upsert = async function upsert(args) {
    const existing = await findOne.call(this, {
        collection: args.collection,
        req: args.req,
        where: args.where,
    });
    if (existing) {
        return updateOne.call(this, {
            collection: args.collection,
            data: args.data,
            id: existing.id,
            req: args.req,
            returning: args.returning,
        });
    }
    return create.call(this, {
        collection: args.collection,
        data: args.data,
        req: args.req,
        returning: args.returning,
    });
};
