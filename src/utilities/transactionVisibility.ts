export const mergeTransactionDocs = (
  docs: Record<string, unknown>[],
  transactionDocs: Record<string, unknown>[],
  deletedIDs: Array<number | string> = [],
): Record<string, unknown>[] => {
  const deleted = new Set(deletedIDs)
  const visibleDocs = deleted.size ? docs.filter((doc) => !deleted.has(doc.id as number | string)) : docs
  if (!transactionDocs.length) return visibleDocs
  const transactionIDs = new Set(transactionDocs.map((doc) => doc.id))

  return [...visibleDocs.filter((doc) => !transactionIDs.has(doc.id)), ...transactionDocs]
}
