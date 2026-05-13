export const escapeIdent = (value: string): string => {
  return `⟨${value.replaceAll('⟩', '\\⟩')}⟩`
}

export const literal = (value: unknown): string => {
  if (value === undefined) {
    return 'NONE'
  }

  return JSON.stringify(value)
}

export const getTableName = (slug: string): string => slug.replaceAll('-', '_')

export const getRecordID = (table: string, id: number | string): string => {
  return `type::record(${literal(table)}, ${literal(String(id))})`
}

export const normalizeID = (id: unknown): number | string => {
  if (typeof id === 'string') {
    const separatorIndex = id.indexOf(':')
    const value = separatorIndex > -1 ? id.slice(separatorIndex + 1) : id

    const cleaned = value.replace(/^`|`$/g, '')

    return /^\d+$/.test(cleaned) ? Number(cleaned) : cleaned
  }

  if (id && typeof id === 'object') {
    const candidate = id as { id?: unknown; tb?: unknown }

    if (candidate.id !== undefined) {
      return normalizeID(String(candidate.id))
    }
  }

  return String(id)
}

export const normalizeDocument = <T extends Record<string, unknown>>(doc: T | null | undefined): T | null => {
  if (!doc) {
    return null
  }

  if (doc.id !== undefined) {
    return {
      ...doc,
      id: normalizeID(doc.id),
    }
  }

  return doc
}
