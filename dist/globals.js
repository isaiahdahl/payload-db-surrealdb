import { buildWhere } from './queries/buildWhere.js';
import { queueTransactionStatement } from './transactions/index.js';
import { getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js';
const getGlobalsTable = (adapter) => getTableName('payload_globals', adapter.tablePrefix);
const getGlobalConfig = (adapter, slug) => adapter.payload.config.globals?.find((global) => global.slug === slug);
const pruneLocales = (doc, fields = [], locales) => {
    if (!locales)
        return;
    for (const field of fields) {
        if (field.type === 'tabs') {
            for (const tab of field.tabs ?? [])
                pruneLocales(tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] : doc, tab.fields ?? [], locales);
            continue;
        }
        if (!field.name) {
            pruneLocales(doc, field.fields ?? [], locales);
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
const applyGlobalReadTransforms = (adapter, slug, doc) => {
    const publishedLocales = Array.isArray(doc.__publishedLocales) ? new Set(doc.__publishedLocales.map(String)) : null;
    if (publishedLocales)
        pruneLocales(doc, getGlobalConfig(adapter, slug)?.fields, publishedLocales);
    delete doc.__publishedLocales;
    return doc;
};
export const createGlobal = async function createGlobal(args) {
    const now = new Date().toISOString();
    const table = getGlobalsTable(this);
    const data = { ...args.data, createdAt: args.data.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now };
    const statement = `CREATE ${getRecordID(table, args.slug)} CONTENT ${literal(data)} RETURN AFTER;`;
    if (await queueTransactionStatement(this, args.req, statement)) {
        return (normalizeDocument({ ...data, id: args.slug }) ?? args.data);
    }
    const result = await this.client.query(statement);
    return (normalizeDocument(result[0]) ?? args.data);
};
export const findGlobal = async function findGlobal(args) {
    const where = buildWhere(args.where);
    const result = await this.client.query(`SELECT * FROM ${getRecordID(getGlobalsTable(this), args.slug)} ${where};`);
    return applyGlobalReadTransforms(this, args.slug, (normalizeDocument(result[0]) ?? {}));
};
export const updateGlobal = async function updateGlobal(args) {
    const now = new Date().toISOString();
    const table = getGlobalsTable(this);
    const existingResult = await this.client.query(`SELECT * FROM ${getRecordID(table, args.slug)};`);
    const existing = (normalizeDocument(existingResult[0]) ?? {});
    const fields = (getGlobalConfig(this, args.slug)?.fields ?? []);
    const data = { ...args.data, createdAt: args.data.createdAt ?? existing.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now };
    const isEmptyObjectReset = data._status === undefined && Object.values(args.data).some((value) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
    if (isEmptyObjectReset) {
        data.__publishedLocales = null;
    }
    const runtimeArgs = args;
    let publishSpecificLocale = typeof runtimeArgs.publishSpecificLocale === 'string' ? runtimeArgs.publishSpecificLocale : (typeof runtimeArgs.locale === 'string' ? runtimeArgs.locale : undefined);
    if (!publishSpecificLocale) {
        const localeCandidates = new Set();
        for (const field of fields) {
            const value = field.localized && field.name ? data[field.name] : undefined;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                for (const locale of Object.keys(value))
                    localeCandidates.add(locale);
            }
        }
        const changedLocales = [...localeCandidates].filter((locale) => fields.some((field) => {
            const next = field.localized && field.name && data[field.name] && typeof data[field.name] === 'object' ? data[field.name][locale] : undefined;
            const prev = field.localized && field.name && existing[field.name] && typeof existing[field.name] === 'object' ? existing[field.name][locale] : undefined;
            return next !== undefined && JSON.stringify(next) !== JSON.stringify(prev);
        }));
        if (changedLocales.length === 1)
            publishSpecificLocale = changedLocales[0];
        else if (localeCandidates.size === 1)
            publishSpecificLocale = [...localeCandidates][0];
    }
    if (publishSpecificLocale && Array.isArray(existing.__publishedLocales) && existing.__publishedLocales.map(String).includes(publishSpecificLocale)) {
        const hasChangedLocaleValue = fields.some((field) => {
            const next = field.localized && field.name && data[field.name] && typeof data[field.name] === 'object' ? data[field.name][publishSpecificLocale] : undefined;
            const prev = field.localized && field.name && existing[field.name] && typeof existing[field.name] === 'object' ? existing[field.name][publishSpecificLocale] : undefined;
            return next !== undefined && JSON.stringify(next) !== JSON.stringify(prev);
        });
        if (!hasChangedLocaleValue)
            publishSpecificLocale = undefined;
    }
    if (data._status === 'published') {
        for (const field of fields) {
            if (field.localized && field.name && data[field.name] && typeof data[field.name] === 'object' && !Array.isArray(data[field.name]) && existing[field.name] && typeof existing[field.name] === 'object' && !Array.isArray(existing[field.name])) {
                data[field.name] = { ...existing[field.name], ...data[field.name] };
            }
        }
    }
    if (data._status === 'published' && typeof publishSpecificLocale === 'string') {
        const locales = Array.isArray(existing.__publishedLocales) ? new Set(existing.__publishedLocales.map(String)) : new Set();
        locales.add(publishSpecificLocale);
        data.__publishedLocales = [...locales];
    }
    else if (data._status === 'published') {
        data.__publishedLocales = null;
        const versionTable = getTableName(`global_${args.slug}_versions`, this.tablePrefix);
        const versions = await this.client.query(`SELECT version, updatedAt FROM ${versionTable} ORDER BY updatedAt DESC;`);
        for (const row of versions) {
            const version = row.version;
            if (!version)
                continue;
            for (const field of fields) {
                if (field.localized && field.name && version[field.name] && typeof version[field.name] === 'object' && !Array.isArray(version[field.name])) {
                    data[field.name] = { ...version[field.name], ...((data[field.name] && typeof data[field.name] === 'object' && !Array.isArray(data[field.name])) ? data[field.name] : {}) };
                }
            }
        }
    }
    const statement = `UPSERT ${getRecordID(table, args.slug)} ${isEmptyObjectReset ? 'CONTENT' : 'MERGE'} ${literal(data)} RETURN AFTER;`;
    if (await queueTransactionStatement(this, args.req, statement)) {
        return (normalizeDocument({ ...existing, ...data, id: args.slug }) ?? args.data);
    }
    const result = await this.client.query(statement);
    return applyGlobalReadTransforms(this, args.slug, (normalizeDocument(result[0]) ?? args.data));
};
