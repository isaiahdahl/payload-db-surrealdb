import { count, create, deleteMany, find, updateOne } from './operations.js';
import { transformRelationshipReads } from './utilities/relationships.js';
import { escapeIdent, getTableName, literal } from './utilities/sql.js';
const versionCollection = (slug) => `${slug}_versions`;
const globalVersionCollection = (slug) => `global_${slug}_versions`;
const latestVersionStatement = (collection, id, parent, updatedAt) => {
    if (parent === undefined || updatedAt === undefined) {
        return null;
    }
    return `UPDATE ${escapeIdent(getTableName(collection))} SET latest = false WHERE meta::id(id) != ${literal(String(id))} AND parent = ${literal(parent)} AND latest = true AND updatedAt < ${literal(updatedAt)}`;
};
const draftWhere = (where = {}) => {
    const reserved = new Set(['and', 'or', 'latest', 'parent', 'autosave', 'snapshot', 'publishedLocale', 'createdAt', 'updatedAt']);
    return Object.fromEntries(Object.entries(where).map(([key, value]) => {
        if ((key === 'and' || key === 'or') && Array.isArray(value)) {
            return [key, value.map((entry) => draftWhere(entry))];
        }
        if (key === 'id') {
            return ['parent', value];
        }
        return [reserved.has(key) || key.startsWith('version.') ? key : `version.${key}`, value];
    }));
};
const getLocaleCodes = (adapter) => {
    const localization = adapter.payload.config.localization;
    const locales = typeof localization === 'object' && Array.isArray(localization.locales) ? localization.locales : [];
    return new Set(locales.map((locale) => typeof locale === 'string' ? locale : locale.code).filter(Boolean));
};
const keepLocalesInValue = (value, allowed, localeCodes) => {
    if (Array.isArray(value)) {
        for (const item of value)
            keepLocalesInValue(item, allowed, localeCodes);
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    const object = value;
    const keys = Object.keys(object);
    const localeKeys = keys.filter((key) => localeCodes.has(key));
    if (localeKeys.length) {
        for (const key of localeKeys) {
            if (!allowed.has(key))
                delete object[key];
        }
    }
    for (const item of Object.values(object))
        keepLocalesInValue(item, allowed, localeCodes);
};
const toDraftDoc = (doc) => {
    if (!doc) {
        return null;
    }
    const version = doc.version && typeof doc.version === 'object' ? doc.version : {};
    return {
        ...version,
        id: doc.parent,
    };
};
export const createVersion = async function createVersion(args) {
    const now = new Date().toISOString();
    const version = { ...args.versionData };
    delete version.id;
    delete version.__publishedLocales;
    const doc = await create.call(this, {
        collection: versionCollection(args.collectionSlug),
        data: {
            autosave: args.autosave,
            createdAt: args.createdAt ?? now,
            latest: true,
            parent: args.parent,
            publishedLocale: args.publishedLocale,
            snapshot: args.snapshot,
            updatedAt: args.updatedAt ?? now,
            version,
        },
        req: undefined,
    });
    const statement = latestVersionStatement(versionCollection(args.collectionSlug), doc.id, args.parent, doc.updatedAt);
    if (statement) {
        await this.client.query(`${statement};`);
    }
    return args.returning === false ? null : doc;
};
export const createGlobalVersion = async function createGlobalVersion(args) {
    const now = new Date().toISOString();
    const version = { ...args.versionData };
    delete version.id;
    delete version.__publishedLocales;
    if (args.publishedLocale)
        keepLocalesInValue(version, new Set([args.publishedLocale]), getLocaleCodes(this));
    const doc = await create.call(this, {
        collection: globalVersionCollection(args.globalSlug),
        data: {
            autosave: args.autosave,
            createdAt: args.createdAt ?? now,
            latest: true,
            publishedLocale: args.publishedLocale,
            snapshot: args.snapshot,
            updatedAt: args.updatedAt ?? now,
            version,
        },
        req: undefined,
    });
    const statement = `UPDATE ${escapeIdent(getTableName(globalVersionCollection(args.globalSlug)))} SET latest = false WHERE meta::id(id) != ${literal(String(doc.id))} AND latest = true AND updatedAt < ${literal(doc.updatedAt)}`;
    await this.client.query(`${statement};`);
    return args.returning === false ? null : doc;
};
export const findVersions = async function findVersions(args) {
    return find.call(this, { ...args, collection: versionCollection(args.collection) });
};
export const findGlobalVersions = async function findGlobalVersions(args) {
    return find.call(this, { ...args, collection: globalVersionCollection(args.global) });
};
export const countVersions = async function countVersions(args) {
    return count.call(this, { ...args, collection: versionCollection(args.collection) });
};
export const countGlobalVersions = async function countGlobalVersions(args) {
    return count.call(this, { ...args, collection: globalVersionCollection(args.global) });
};
export const deleteVersions = async function deleteVersions(args) {
    await deleteMany.call(this, {
        collection: args.collection ? versionCollection(args.collection) : globalVersionCollection(args.globalSlug),
        req: undefined,
        where: args.where,
    });
};
const getVersionUpdateData = (versionData) => {
    if (versionData.version && typeof versionData.version === 'object') {
        const { createdAt, updatedAt, ...rest } = versionData;
        if (rest.version && typeof rest.version === 'object')
            delete rest.version.__publishedLocales;
        return {
            ...rest,
            ...(createdAt !== undefined ? { createdAt } : {}),
            ...(updatedAt !== undefined ? { updatedAt } : {}),
        };
    }
    const version = { ...versionData };
    const data = { version };
    if ('createdAt' in version) {
        data.createdAt = version.createdAt;
        delete version.createdAt;
    }
    if ('updatedAt' in version) {
        data.updatedAt = version.updatedAt;
        delete version.updatedAt;
    }
    return data;
};
export const updateVersion = async function updateVersion(args) {
    const data = getVersionUpdateData(args.versionData);
    const result = await updateOne.call(this, {
        collection: versionCollection(args.collection),
        data,
        id: args.id,
        req: undefined,
        where: args.where,
    });
    return args.returning === false ? null : result;
};
export const updateGlobalVersion = async function updateGlobalVersion(args) {
    const data = getVersionUpdateData(args.versionData);
    const result = await updateOne.call(this, {
        collection: globalVersionCollection(args.global),
        data,
        id: args.id,
        req: undefined,
        where: args.where,
    });
    return args.returning === false ? null : result;
};
export const queryDrafts = async function queryDrafts(args) {
    const result = await find.call(this, {
        collection: versionCollection(args.collection),
        joins: args.joins,
        limit: args.limit,
        locale: args.locale,
        page: args.page,
        pagination: args.pagination,
        req: args.req,
        select: args.select,
        sort: args.sort,
        where: { and: [{ latest: { equals: true } }, draftWhere(args.where ?? {})] },
    });
    const docs = result.docs.map((doc) => toDraftDoc(doc)).filter(Boolean);
    await transformRelationshipReads(this, args.collection, docs, typeof args.depth === 'number' ? args.depth : 0, args.joins, args.locale);
    return {
        ...result,
        docs,
    };
};
