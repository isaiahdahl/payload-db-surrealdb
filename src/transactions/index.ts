import type { BeginTransaction, CommitTransaction, RollbackTransaction } from 'payload'

import type { SurrealAdapter } from '../index.js'

export type SurrealTransactionSession = {
  createdAt: number
  deletedIDs?: Record<string, Array<number | string>>
  docs?: Record<string, Record<string, unknown>[]>
  statements: string[]
}

const randomID = (): string => {
  const crypto = globalThis.crypto as { randomUUID?: () => string } | undefined

  return crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export const getTransactionID = async (req?: { transactionID?: Promise<number | string | null> | number | string | null }): Promise<null | string> => {
  const incomingID = req?.transactionID

  if (!incomingID) {
    return null
  }

  const resolved = incomingID instanceof Promise ? await incomingID : incomingID

  return resolved === null || resolved === undefined ? null : String(resolved)
}

export const getTransaction = async (
  adapter: SurrealAdapter,
  req?: { transactionID?: Promise<number | string | null> | number | string | null },
): Promise<null | SurrealTransactionSession> => {
  const transactionID = await getTransactionID(req)

  if (!transactionID) {
    return null
  }

  return (adapter.sessions as unknown as Record<string, SurrealTransactionSession> | undefined)?.[transactionID] ?? null
}

export const queueTransactionStatement = async (
  adapter: SurrealAdapter,
  req: { transactionID?: Promise<number | string | null> | number | string | null } | undefined,
  statement: string,
): Promise<boolean> => {
  const transaction = await getTransaction(adapter, req)

  if (!transaction) {
    return false
  }

  transaction.statements.push(statement.trim().endsWith(';') ? statement.trim() : `${statement.trim()};`)

  return true
}

export const addTransactionDoc = async (
  adapter: SurrealAdapter,
  req: { transactionID?: Promise<number | string | null> | number | string | null } | undefined,
  collection: string,
  doc: Record<string, unknown>,
): Promise<void> => {
  const transaction = await getTransaction(adapter, req)
  if (!transaction) return
  transaction.docs ??= {}
  const snapshot = typeof structuredClone === 'function'
    ? structuredClone(doc)
    : JSON.parse(JSON.stringify(doc))
  transaction.deletedIDs ??= {}
  transaction.deletedIDs[collection] = (transaction.deletedIDs[collection] ?? []).filter((id) => id !== snapshot.id)
  transaction.docs[collection] = [
    ...(transaction.docs[collection] ?? []).filter((existing) => existing.id !== snapshot.id),
    snapshot,
  ]
}

export const addTransactionDeletedDocs = async (
  adapter: SurrealAdapter,
  req: { transactionID?: Promise<number | string | null> | number | string | null } | undefined,
  collection: string,
  docs: Record<string, unknown>[],
): Promise<void> => {
  const transaction = await getTransaction(adapter, req)
  if (!transaction || !docs.length) return
  transaction.deletedIDs ??= {}
  const deleted = new Set([...(transaction.deletedIDs[collection] ?? []), ...docs.map((doc) => doc.id as number | string).filter((id) => id !== undefined)])
  transaction.deletedIDs[collection] = [...deleted]
  transaction.docs ??= {}
  transaction.docs[collection] = (transaction.docs[collection] ?? []).filter((doc) => !deleted.has(doc.id as number | string))
}

export const getTransactionDeletedIDs = async (
  adapter: SurrealAdapter,
  req: { transactionID?: Promise<number | string | null> | number | string | null } | undefined,
  collection: string,
): Promise<Array<number | string>> => {
  const transaction = await getTransaction(adapter, req)
  return transaction?.deletedIDs?.[collection] ?? []
}

export const getTransactionDocs = async (
  adapter: SurrealAdapter,
  req: { transactionID?: Promise<number | string | null> | number | string | null } | undefined,
  collection: string,
): Promise<Record<string, unknown>[]> => {
  const transaction = await getTransaction(adapter, req)
  return transaction?.docs?.[collection] ?? []
}

export const beginTransaction: BeginTransaction = async function beginTransaction(this: SurrealAdapter) {
  const id = randomID()

  if (!this.sessions) {
    this.sessions = {}
  }

  ;(this.sessions as unknown as Record<string, SurrealTransactionSession>)[id] = {
    createdAt: Date.now(),
    statements: [],
  }

  return id
}

export const commitTransaction: CommitTransaction = async function commitTransaction(this: SurrealAdapter, incomingID = '') {
  const transactionID = String(await incomingID)
  const sessions = this.sessions as unknown as Record<string, SurrealTransactionSession> | undefined
  const transaction = sessions?.[transactionID]

  if (!transaction) {
    return
  }

  delete sessions![transactionID]

  if (transaction.statements.length === 0) {
    return
  }

  await this.client.query(`BEGIN TRANSACTION;\n${transaction.statements.join('\n')}\nCOMMIT TRANSACTION;`)
}

export const rollbackTransaction: RollbackTransaction = async function rollbackTransaction(this: SurrealAdapter, incomingID = '') {
  const transactionID = String(await incomingID)
  const sessions = this.sessions as unknown as Record<string, SurrealTransactionSession> | undefined

  if (!sessions?.[transactionID]) {
    return
  }

  delete sessions[transactionID]
}
