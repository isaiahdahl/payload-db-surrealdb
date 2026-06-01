const locks = new Map<string, Promise<void>>()
const transactionLockReleases = new Map<string, Array<() => void>>()

export const acquirePayloadJobUpdateLock = async (id: string): Promise<() => void> => {
  const previous = locks.get(id) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })

  locks.set(id, previous.then(() => current, () => current))
  await previous.catch(() => undefined)

  let released = false
  return () => {
    if (released) {
      return
    }

    released = true
    release()

    if (locks.get(id) === current) {
      locks.delete(id)
    }
  }
}

export const retainPayloadJobUpdateLockForTransaction = (transactionID: string, release: () => void): void => {
  transactionLockReleases.set(transactionID, [
    ...(transactionLockReleases.get(transactionID) ?? []),
    release,
  ])
}

export const releasePayloadJobUpdateLocksForTransaction = (transactionID: string): void => {
  const releases = transactionLockReleases.get(transactionID) ?? []
  transactionLockReleases.delete(transactionID)

  for (const release of releases) {
    release()
  }
}

export const withPayloadJobUpdateLock = async <T>(id: string, operation: () => Promise<T>): Promise<T> => {
  const release = await acquirePayloadJobUpdateLock(id)

  try {
    return await operation()
  } finally {
    release()
  }
}
