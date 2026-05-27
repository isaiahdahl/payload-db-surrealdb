export const mergeTransactionDocs = (docs, transactionDocs, deletedIDs = []) => {
    const deleted = new Set(deletedIDs);
    const visibleDocs = deleted.size ? docs.filter((doc) => !deleted.has(doc.id)) : docs;
    if (!transactionDocs.length)
        return visibleDocs;
    const transactionIDs = new Set(transactionDocs.map((doc) => doc.id));
    return [...visibleDocs.filter((doc) => !transactionIDs.has(doc.id)), ...transactionDocs];
};
