export const removeDottedOperatorKeys = (data: Record<string, unknown>): Record<string, unknown> => {
  for (const [key, value] of Object.entries(data)) {
    if (key.includes('.') && value && typeof value === 'object') {
      delete data[key]
    }
  }

  return data
}

export const getAtomicValueAtPath = (doc: Record<string, unknown>, path: string): unknown => {
  if (path === 'id') {
    return doc.id
  }

  return path.split('.').reduce<unknown>((value, part) => {
    if (Array.isArray(value)) {
      const index = Number(part)

      return Number.isInteger(index) ? value[index] : undefined
    }

    if (value && typeof value === 'object') {
      return (value as Record<string, unknown>)[part]
    }

    return undefined
  }, doc)
}

export const setAtomicValueAtPath = (doc: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.')
  let target: unknown = doc

  for (const [index, part] of parts.entries()) {
    if (!target || typeof target !== 'object') {
      return
    }

    if (index === parts.length - 1) {
      if (Array.isArray(target)) {
        const arrayIndex = Number(part)
        if (Number.isInteger(arrayIndex)) target[arrayIndex] = value
      } else {
        ;(target as Record<string, unknown>)[part] = value
      }

      return
    }

    if (Array.isArray(target)) {
      target = target[Number(part)]
    } else {
      const objectTarget = target as Record<string, unknown>
      if (!objectTarget[part] || typeof objectTarget[part] !== 'object') {
        objectTarget[part] = {}
      }
      target = objectTarget[part]
    }
  }
}
