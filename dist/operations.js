import { SurrealDBError } from './client.js';
import { buildWhere, pathToSQL } from './queries/buildWhere.js';
import { applyDefaults, applySelect, getCollectionConfig, hasTimestamps } from './utilities/fields.js';
import { escapeIdent, getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js';
const getSortSQL = (sort) => {
    const sortValues = (Array.isArray(sort) ? sort : sort ? [sort] : [])
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean);
    if (!sortValues.length) {
        return 'ORDER BY createdAt DESC';
    }
    const parts = sortValues.map((sortValue) => {
        const direction = sortValue.startsWith('-') ? 'DESC' : 'ASC';
        const field = sortValue.replace(/^-/, '');
        return `${pathToSQL(field)} ${direction}`;
    });
    return `ORDER BY ${parts.join(', ')}`;
};
const getPagination = (args) => {
    const limit = Number(args.limit ?? 10);
    const page = Number(args.page ?? 1);
    const start = Number(args.skip ?? Math.max(page - 1, 0) * (limit > 0 ? limit : 0));
    const currentPage = args.skip !== undefined && limit > 0 ? Math.floor(start / limit) + 1 : page;
    return { currentPage, limit, start };
};
const mapWriteError = (error) => {
    if (error instanceof SurrealDBError && error.duplicate) {
        error.code = error.code ?? 'DUPLICATE_KEY';
    }
    throw error;
};
const normalizeDocs = (docs, select) => docs.map((doc) => applySelect(normalizeDocument(doc), select)).filter(Boolean);
export const create = async function create(args) {
    const table = getTableName(args.collection, this.tablePrefix);
    const id = args.customID ?? args.data.id;
    const data = applyDefaults({ ...args.data }, getCollectionConfig(this, args.collection)?.fields);
    const shouldReturn = args.returning !== false;
    if (id) {
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
    const target = id ? getRecordID(table, id) : escapeIdent(table);
    try {
        const result = await this.client.query(`CREATE ${target} CONTENT ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`);
        return shouldReturn ? applySelect(normalizeDocument(result[0]), args.select) : null;
    }
    catch (error) {
        mapWriteError(error);
    }
};
export const findOne = async function findOne(args) {
    const table = escapeIdent(getTableName(args.collection, this.tablePrefix));
    const where = buildWhere(args.where);
    const result = await this.client.query(`SELECT * FROM ${table} ${where} LIMIT 1;`);
    return applySelect(normalizeDocument(result[0]), args.select);
};
export const find = async function find(args) {
    const table = escapeIdent(getTableName(args.collection, this.tablePrefix));
    const { currentPage, limit, start } = getPagination(args);
    const where = buildWhere(args.where);
    const sort = getSortSQL(args.sort);
    const limitSQL = limit > 0 ? `LIMIT ${limit} START ${start}` : '';
    const docs = await this.client.query(`SELECT * FROM ${table} ${where} ${sort} ${limitSQL};`);
    const totalDocs = await count.call(this, { collection: args.collection, req: args.req, where: args.where });
    const totalPages = limit > 0 ? Math.ceil(totalDocs.totalDocs / limit) : 1;
    return {
        docs: normalizeDocs(docs, args.select),
        hasNextPage: limit > 0 ? currentPage < totalPages : false,
        hasPrevPage: currentPage > 1,
        limit,
        nextPage: limit > 0 && currentPage < totalPages ? currentPage + 1 : null,
        page: currentPage,
        pagingCounter: totalDocs.totalDocs > 0 ? start + 1 : 0,
        prevPage: currentPage > 1 ? currentPage - 1 : null,
        totalDocs: totalDocs.totalDocs,
        totalPages,
    };
};
export const count = async function count(args) {
    const table = escapeIdent(getTableName(args.collection, this.tablePrefix));
    const where = buildWhere(args.where);
    const result = await this.client.query(`SELECT count() AS count FROM ${table} ${where} GROUP ALL;`);
    return { totalDocs: result[0]?.count ?? 0 };
};
export const updateOne = async function updateOne(args) {
    const table = getTableName(args.collection, this.tablePrefix);
    const data = applyDefaults({ ...args.data }, getCollectionConfig(this, args.collection)?.fields);
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
    if (args.id) {
        try {
            const result = await this.client.query(`UPDATE ${getRecordID(table, args.id)} MERGE ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`);
            return shouldReturn ? applySelect(normalizeDocument(result[0]), args.select) : null;
        }
        catch (error) {
            mapWriteError(error);
        }
    }
    const found = await findOne.call(this, { collection: args.collection, req: args.req, where: args.where });
    if (!found) {
        return null;
    }
    try {
        const result = await this.client.query(`UPDATE ${getRecordID(table, found.id)} MERGE ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`);
        return shouldReturn ? applySelect(normalizeDocument(result[0]), args.select) : null;
    }
    catch (error) {
        mapWriteError(error);
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
    await this.client.query(`DELETE ${getRecordID(getTableName(args.collection, this.tablePrefix), found.id)};`);
    return args.returning === false ? null : found;
};
export const deleteMany = async function deleteMany(args) {
    const table = escapeIdent(getTableName(args.collection, this.tablePrefix));
    const where = buildWhere(args.where);
    await this.client.query(`DELETE ${table} ${where};`);
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
