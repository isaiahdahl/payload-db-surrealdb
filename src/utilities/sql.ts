export const escapeIdent = (value: string): string => {
  return `⟨${value.replaceAll('⟩', '\\⟩')}⟩`
}

export const literal = (value: unknown): string => {
  if (value === undefined) {
    return 'NONE'
  }

  return JSON.stringify(value)
}

export const normalizeTableComponent = (value: string): string => value.replaceAll('-', '_')

export const getTableName = (slug: string, tablePrefix?: string): string => {
  const table = normalizeTableComponent(slug)
  const prefix = tablePrefix ? normalizeTableComponent(tablePrefix).replace(/_+$/, '') : ''

  return prefix ? `${prefix}_${table}` : table
}

export const getRecordID = (table: string, id: number | string): string => {
  return `type::record(${literal(table)}, ${literal(String(id))})`
}

export const normalizeID = (id: unknown): number | string => {
  if (typeof id === 'string') {
    const separatorIndex = id.indexOf(':')
    const value = separatorIndex > -1 ? id.slice(separatorIndex + 1) : id

    return value.replace(/^`|`$/g, '')
  }

  if (id && typeof id === 'object') {
    const candidate = id as { id?: unknown; tb?: unknown }

    if (candidate.id !== undefined) {
      return normalizeID(candidate.id)
    }
  }

  if (typeof id === 'number') {
    return id
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
