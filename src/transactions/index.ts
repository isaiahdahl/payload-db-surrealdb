import type { BeginTransaction, CommitTransaction, RollbackTransaction } from 'payload'

export const beginTransaction: BeginTransaction = async () => null
export const commitTransaction: CommitTransaction = async () => {}
export const rollbackTransaction: RollbackTransaction = async () => {}
