type Field = {
  blocks?: Array<{
    fields?: Field[]
    slug?: string
  }>
  defaultValue?: unknown
  fields?: Field[]
  hasMany?: boolean
  index?: boolean
  localized?: boolean
  name?: string
  tabs?: Array<{
    fields?: Field[]
    name?: string
  }>
  type?: string
  unique?: boolean
  virtual?: boolean | string
}

export const getCollectionConfig = (adapter: { payload?: { config?: { collections?: any[] } } }, slug: string) =>
  adapter.payload?.config?.collections?.find((collection) => collection.slug === slug)

export const hasTimestamps = (adapter: { payload?: { config?: { collections?: any[] } } }, slug: string): boolean => {
  const collection = getCollectionConfig(adapter, slug)

  return collection?.timestamps !== false
}

const cloneDefault = (value: unknown): unknown => {
  if (typeof value === 'function') {
    return (value as () => unknown)()
  }

  if (value === undefined || value === null) {
    return value
  }

  return structuredClone(value)
}

const getNestedFields = (field: Field, value?: unknown): Field[] => {
  if (field.type === 'tabs') {
    return (field.tabs ?? []).flatMap((tab) => tab.fields ?? [])
  }

  if (field.type === 'blocks' && value && typeof value === 'object' && !Array.isArray(value)) {
    const blockType = (value as Record<string, unknown>).blockType
    const block = (field.blocks ?? []).find((candidate) => candidate.slug === blockType)

    return block?.fields ?? []
  }

  return field.fields ?? []
}

const isOperatorObject = (value: unknown): boolean =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).some((key) => key.startsWith('$')))

const transformValueForWrite = (value: unknown, field: Field): unknown => {
  if (value === undefined || isOperatorObject(value)) {
    return value
  }

  if (field.hasMany && Array.isArray(value)) {
    return value.map((item) => transformValueForWrite(item, { ...field, hasMany: false }))
  }

  if (field.localized && value && typeof value === 'object' && !Array.isArray(value) && !isOperatorObject(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([locale, localeValue]) => [
        locale,
        transformValueForWrite(localeValue, { ...field, localized: false }),
      ]),
    )
  }

  if (field.type === 'date') {
    if (typeof value === 'number') {
      return new Date(value).toISOString()
    }

    if (value instanceof Date) {
      return value.toISOString()
    }
  }

  if (field.type === 'text' || field.type === 'textarea' || field.type === 'email') {
    return value === null ? value : String(value)
  }

  if (field.type === 'number') {
    if (value === null || value === '') {
      return value
    }

    const number = Number(value)
    return Number.isNaN(number) ? value : number
  }

  // Payload expects default point values written through db.create as GeoJSON-like objects.
  if (field.type === 'point' && Array.isArray(value)) {
    return { type: 'Point', coordinates: value }
  }

  if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
    return value.map((row) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        return sanitizeDataForWrite(row as Record<string, unknown>, getNestedFields(field, row))
      }

      return row
    })
  }

  const nestedFields = getNestedFields(field, value)

  if (!nestedFields.length) {
    return value
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return sanitizeDataForWrite(value as Record<string, unknown>, nestedFields)
  }

  return value
}

export const applyDefaults = (data: Record<string, unknown>, fields: Field[] = []): Record<string, unknown> => sanitizeDataForWrite(data, fields)

export const sanitizeDataForWrite = (data: Record<string, unknown>, fields: Field[] = []): Record<string, unknown> => {
  if (!fields.length) {
    return { ...data }
  }

  const output: Record<string, unknown> = {}

  if (data.id !== undefined) {
    output.id = data.id
  }

  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) {
        if (tab.name) {
          const value = data[tab.name]
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            output[tab.name] = sanitizeDataForWrite(value as Record<string, unknown>, tab.fields ?? [])
          } else if (value === undefined) {
            const nested = sanitizeDataForWrite({}, tab.fields ?? [])
            if (Object.keys(nested).length) output[tab.name] = nested
          }
        } else {
          Object.assign(output, sanitizeDataForWrite(data, tab.fields ?? []))
        }
      }

      continue
    }

    if (!field.name) {
      if (field.fields?.length) {
        Object.assign(output, sanitizeDataForWrite(data, field.fields))
      }

      continue
    }

    if (field.virtual) {
      continue
    }

    let value = data[field.name]

    if (value === undefined && field.defaultValue !== undefined) {
      value = cloneDefault(field.defaultValue)
    }

    if (value !== undefined) {
      output[field.name] = transformValueForWrite(value, field)
    }
  }

  return output
}

export const getValueAtPath = (doc: Record<string, unknown>, path: string): unknown => {
  if (path === 'id') {
    return doc.id
  }

  const getValue = (value: unknown, parts: string[]): unknown => {
    if (!parts.length) {
      return value
    }

    if (Array.isArray(value)) {
      const values = value
        .flatMap((item) => {
          const nestedValue = getValue(item, parts)
          return Array.isArray(nestedValue) ? nestedValue : [nestedValue]
        })
        .filter((item) => item !== undefined)

      return values.length ? values : undefined
    }

    if (value && typeof value === 'object') {
      const [part, ...rest] = parts
      const objectValue = value as Record<string, unknown>

      if (part in objectValue) {
        return getValue(objectValue[part], rest)
      }

      if (typeof objectValue.relationTo === 'string' && objectValue.value && typeof objectValue.value === 'object') {
        return getValue(objectValue.value, parts)
      }
    }

    return undefined
  }

  return getValue(doc, path.split('.'))
}

export const setValueAtPath = (doc: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.')
  let target = doc

  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      target[part] = value
      return
    }

    if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) {
      target[part] = {}
    }

    target = target[part] as Record<string, unknown>
  }
}

export const applySelect = <T extends Record<string, unknown> | null>(doc: T, select?: Record<string, unknown>): T => {
  if (!doc || !select || Object.keys(select).length === 0) {
    return doc
  }

  const entries = Object.entries(select).filter(([, value]) => Boolean(value))

  if (!entries.length) {
    return doc
  }

  const projected: Record<string, unknown> = { id: doc.id }

  for (const [path] of entries) {
    const value = getValueAtPath(doc, path)

    if (value !== undefined) {
      setValueAtPath(projected, path, value)
    }
  }

  return projected as T
}

const simpleIndexFieldTypes = new Set([
  'checkbox',
  'code',
  'date',
  'email',
  'number',
  'radio',
  'select',
  'text',
  'textarea',
])

export type IndexedField = {
  name: string
  unique: boolean
}

export const getIndexedFields = (fields: Field[] = []): IndexedField[] => {
  const indexedFields: IndexedField[] = []

  for (const field of fields) {
    if (!field.name) {
      continue
    }

    if ((field.index || field.unique) && simpleIndexFieldTypes.has(field.type ?? '')) {
      indexedFields.push({ name: field.name, unique: Boolean(field.unique) })
    }
  }

  return indexedFields
}
