import { buildWhere } from './queries/buildWhere.js';
import { applyDefaults, getCollectionConfig, hasTimestamps } from './utilities/fields.js';
import { escapeIdent, getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js';
const getSortSQL = (sort) => {
    const sortValue = Array.isArray(sort) ? sort[0] : sort;
    if (!sortValue) {
        return 'ORDER BY createdAt DESC';
    }
    const direction = sortValue.startsWith('-') ? 'DESC' : 'ASC';
    const field = sortValue.replace(/^-/, '');
    return `ORDER BY ${field} ${direction}`;
};
export const create = async function create(args) {
    const table = getTableName(args.collection);
    const id = args.customID ?? args.data.id;
    const data = applyDefaults({ ...args.data }, getCollectionConfig(this, args.collection)?.fields);
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
    const result = await this.client.query(`CREATE ${target} CONTENT ${literal(data)} RETURN AFTER;`);
    return normalizeDocument(result[0]);
};
export const findOne = async function findOne(args) {
    const table = escapeIdent(getTableName(args.collection));
    const where = buildWhere(args.where);
    const result = await this.client.query(`SELECT * FROM ${table} ${where} LIMIT 1;`);
    return normalizeDocument(result[0]);
};
export const find = async function find(args) {
    const table = escapeIdent(getTableName(args.collection));
    const limit = args.limit ?? 10;
    const page = args.page ?? 1;
    const start = args.skip ?? (page - 1) * (limit || 0);
    const where = buildWhere(args.where);
    const sort = getSortSQL(args.sort);
    const limitSQL = limit > 0 ? `LIMIT ${limit} START ${start}` : '';
    const docs = await this.client.query(`SELECT * FROM ${table} ${where} ${sort} ${limitSQL};`);
    const totalDocs = await count.call(this, { collection: args.collection, req: args.req, where: args.where });
    const totalPages = limit > 0 ? Math.ceil(totalDocs.totalDocs / limit) : 1;
    return {
        docs: docs.map((doc) => normalizeDocument(doc)),
        hasNextPage: limit > 0 ? page < totalPages : false,
        hasPrevPage: page > 1,
        limit,
        nextPage: limit > 0 && page < totalPages ? page + 1 : null,
        page,
        pagingCounter: start + 1,
        prevPage: page > 1 ? page - 1 : null,
        totalDocs: totalDocs.totalDocs,
        totalPages,
    };
};
export const count = async function count(args) {
    const table = escapeIdent(getTableName(args.collection));
    const where = buildWhere(args.where);
    const result = await this.client.query(`SELECT count() AS count FROM ${table} ${where} GROUP ALL;`);
    return { totalDocs: result[0]?.count ?? 0 };
};
export const updateOne = async function updateOne(args) {
    const table = getTableName(args.collection);
    const data = applyDefaults({ ...args.data }, getCollectionConfig(this, args.collection)?.fields);
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
        const result = await this.client.query(`UPDATE ${getRecordID(table, args.id)} MERGE ${literal(data)} RETURN AFTER;`);
        return normalizeDocument(result[0]);
    }
    const found = await findOne.call(this, { collection: args.collection, req: args.req, where: args.where });
    if (!found) {
        return null;
    }
    const result = await this.client.query(`UPDATE ${getRecordID(table, found.id)} MERGE ${literal(data)} RETURN AFTER;`);
    return normalizeDocument(result[0]);
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
        docs.push(await updateOne.call(this, { collection: args.collection, data: args.data, id: doc.id, req: args.req }));
    }
    return docs;
};
export const deleteOne = async function deleteOne(args) {
    const found = await findOne.call(this, { collection: args.collection, req: args.req, where: args.where });
    if (!found) {
        return null;
    }
    await this.client.query(`DELETE ${getRecordID(getTableName(args.collection), found.id)};`);
    return found;
};
export const deleteMany = async function deleteMany(args) {
    const table = escapeIdent(getTableName(args.collection));
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
        });
    }
    return create.call(this, {
        collection: args.collection,
        data: args.data,
        req: args.req,
    });
};
