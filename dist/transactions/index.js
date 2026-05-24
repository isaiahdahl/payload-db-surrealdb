const randomID = () => {
    const crypto = globalThis.crypto;
    return crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};
export const getTransactionID = async (req) => {
    const incomingID = req?.transactionID;
    if (!incomingID) {
        return null;
    }
    const resolved = incomingID instanceof Promise ? await incomingID : incomingID;
    return resolved === null || resolved === undefined ? null : String(resolved);
};
export const getTransaction = async (adapter, req) => {
    const transactionID = await getTransactionID(req);
    if (!transactionID) {
        return null;
    }
    return adapter.sessions?.[transactionID] ?? null;
};
export const queueTransactionStatement = async (adapter, req, statement) => {
    const transaction = await getTransaction(adapter, req);
    if (!transaction) {
        return false;
    }
    transaction.statements.push(statement.trim().endsWith(';') ? statement.trim() : `${statement.trim()};`);
    return true;
};
export const addTransactionDoc = async (adapter, req, collection, doc) => {
    const transaction = await getTransaction(adapter, req);
    if (!transaction)
        return;
    transaction.docs ??= {};
    const snapshot = typeof structuredClone === 'function'
        ? structuredClone(doc)
        : JSON.parse(JSON.stringify(doc));
    transaction.docs[collection] = [
        ...(transaction.docs[collection] ?? []).filter((existing) => existing.id !== snapshot.id),
        snapshot,
    ];
};
export const getTransactionDocs = async (adapter, req, collection) => {
    const transaction = await getTransaction(adapter, req);
    return transaction?.docs?.[collection] ?? [];
};
export const beginTransaction = async function beginTransaction() {
    const id = randomID();
    if (!this.sessions) {
        this.sessions = {};
    }
    ;
    this.sessions[id] = {
        createdAt: Date.now(),
        statements: [],
    };
    return id;
};
export const commitTransaction = async function commitTransaction(incomingID = '') {
    const transactionID = String(await incomingID);
    const sessions = this.sessions;
    const transaction = sessions?.[transactionID];
    if (!transaction) {
        return;
    }
    delete sessions[transactionID];
    if (transaction.statements.length === 0) {
        return;
    }
    await this.client.query(`BEGIN TRANSACTION;\n${transaction.statements.join('\n')}\nCOMMIT TRANSACTION;`);
};
export const rollbackTransaction = async function rollbackTransaction(incomingID = '') {
    const transactionID = String(await incomingID);
    const sessions = this.sessions;
    if (!sessions?.[transactionID]) {
        return;
    }
    delete sessions[transactionID];
};
