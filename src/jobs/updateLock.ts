const locks = new Map<string, Promise<void>>()

export const withPayloadJobUpdateLock = async <T>(id: string, operation: () => Promise<T>): Promise<T> => {
  const previous = locks.get(id) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })

  locks.set(id, previous.then(() => current, () => current))
  await previous.catch(() => undefined)

  try {
    return await operation()
  } finally {
    release()

    if (locks.get(id) === current) {
      locks.delete(id)
    }
  }
}
