import { count, create, deleteMany, find, updateOne } from './operations.js';
import { queueTransactionStatement } from './transactions/index.js';
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
        req: args.req,
    });
    const statement = latestVersionStatement(versionCollection(args.collectionSlug), doc.id, args.parent, doc.updatedAt);
    if (statement) {
        if (!(await queueTransactionStatement(this, args.req, statement))) {
            await this.client.query(`${statement};`);
        }
    }
    return args.returning === false ? null : doc;
};
export const createGlobalVersion = async function createGlobalVersion(args) {
    const now = new Date().toISOString();
    const version = { ...args.versionData };
    delete version.id;
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
        req: args.req,
    });
    const statement = `UPDATE ${escapeIdent(getTableName(globalVersionCollection(args.globalSlug)))} SET latest = false WHERE meta::id(id) != ${literal(String(doc.id))} AND latest = true AND updatedAt < ${literal(doc.updatedAt)}`;
    if (!(await queueTransactionStatement(this, args.req, statement))) {
        await this.client.query(`${statement};`);
    }
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
        req: args.req,
        where: args.where,
    });
};
export const updateVersion = async function updateVersion(args) {
    const version = { ...args.versionData };
    const data = { version };
    if ('createdAt' in version) {
        data.createdAt = version.createdAt;
        delete version.createdAt;
    }
    if ('updatedAt' in version) {
        data.updatedAt = version.updatedAt;
        delete version.updatedAt;
    }
    const result = await updateOne.call(this, {
        collection: versionCollection(args.collection),
        data,
        id: args.id,
        req: args.req,
        where: args.where,
    });
    return args.returning === false ? null : result;
};
export const updateGlobalVersion = async function updateGlobalVersion(args) {
    const version = { ...args.versionData };
    const data = { version };
    if ('createdAt' in version) {
        data.createdAt = version.createdAt;
        delete version.createdAt;
    }
    if ('updatedAt' in version) {
        data.updatedAt = version.updatedAt;
        delete version.updatedAt;
    }
    const result = await updateOne.call(this, {
        collection: globalVersionCollection(args.global),
        data,
        id: args.id,
        req: args.req,
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
    if (!docs.length) {
        const baseSort = Array.isArray(args.sort)
            ? args.sort.map((value) => String(value).replace(/^-version\./, '-').replace(/^version\./, ''))
            : typeof args.sort === 'string'
                ? args.sort.replace(/^-version\./, '-').replace(/^version\./, '')
                : args.sort;
        return find.call(this, {
            collection: args.collection,
            limit: args.limit,
            locale: args.locale,
            page: args.page,
            pagination: args.pagination,
            req: args.req,
            select: args.select,
            sort: baseSort,
            where: args.where,
        });
    }
    return {
        ...result,
        docs,
    };
};
