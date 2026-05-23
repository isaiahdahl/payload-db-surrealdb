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
    localized?: boolean
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

type FieldContext = {
  insideLocalized?: boolean
  locale?: string
  req?: unknown
  user?: unknown
}

const cloneDefault = (value: unknown, context: FieldContext = {}): unknown => {
  if (typeof value === 'function') {
    return (value as (args: FieldContext) => unknown)(context)
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

const transformValueForWrite = (value: unknown, field: Field, context: FieldContext = {}): unknown => {
  if (value === undefined || isOperatorObject(value)) {
    return value
  }

  if (field.hasMany && Array.isArray(value)) {
    return value.map((item) => transformValueForWrite(item, { ...field, hasMany: false }, context))
  }

  if (field.localized && value === null) {
    return {}
  }

  if (field.localized && !context.insideLocalized && (Array.isArray(value) || (value !== undefined && (typeof value !== 'object' || value === null)))) {
    const locale = typeof context.locale === 'string' ? context.locale : 'en'
    return { [locale]: transformValueForWrite(value, { ...field, localized: false }, context) }
  }

  if (field.localized && value && typeof value === 'object' && !Array.isArray(value) && !isOperatorObject(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, localeValue]) => localeValue !== null && !((field.type === 'array' || field.type === 'blocks') && Array.isArray(localeValue) && localeValue.length === 0))
        .map(([locale, localeValue]) => [
          locale,
          transformValueForWrite(localeValue, { ...field, localized: false }, { ...context, insideLocalized: true }),
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
        const sanitized = sanitizeDataForWrite(row as Record<string, unknown>, getNestedFields(field, row), context)
        if (field.type === 'blocks' && 'blockType' in row) sanitized.blockType = (row as Record<string, unknown>).blockType
        if ('id' in row) sanitized.id = (row as Record<string, unknown>).id
        return sanitized
      }

      return row
    })
  }

  const nestedFields = getNestedFields(field, value)

  if (!nestedFields.length) {
    return value
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return sanitizeDataForWrite(value as Record<string, unknown>, nestedFields, context)
  }

  return value
}

export const applyDefaults = (data: Record<string, unknown>, fields: Field[] = [], context: FieldContext = {}): Record<string, unknown> => sanitizeDataForWrite(data, fields, context)

export const sanitizeDataForWrite = (data: Record<string, unknown>, fields: Field[] = [], context: FieldContext = {}): Record<string, unknown> => {
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
            output[tab.name] = tab.localized
              ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([locale, localeValue]) => [
                  locale,
                  localeValue && typeof localeValue === 'object' && !Array.isArray(localeValue)
                    ? sanitizeDataForWrite(localeValue as Record<string, unknown>, tab.fields ?? [], { ...context, insideLocalized: true })
                    : localeValue,
                ]))
              : sanitizeDataForWrite(value as Record<string, unknown>, tab.fields ?? [], context)
          } else if (value === undefined) {
            const nested = sanitizeDataForWrite({}, tab.fields ?? [], context)
            if (Object.keys(nested).length) output[tab.name] = nested
          }
        } else {
          Object.assign(output, sanitizeDataForWrite(data, tab.fields ?? [], context))
        }
      }

      continue
    }

    if (!field.name) {
      if (field.fields?.length) {
        Object.assign(output, sanitizeDataForWrite(data, field.fields, context))
      }

      continue
    }

    if (field.virtual) {
      continue
    }

    let value = data[field.name]

    if (value === undefined && field.defaultValue !== undefined) {
      value = cloneDefault(field.defaultValue, context)
    }

    if (value === undefined && field.type === 'select' && field.hasMany) {
      value = []
    }

    if (value !== undefined) {
      output[field.name] = transformValueForWrite(value, field, context)
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

const hasTruthySelect = (select: Record<string, unknown>): boolean =>
  Object.values(select).some((value) => value === true || (value && typeof value === 'object' && !Array.isArray(value) && hasTruthySelect(value as Record<string, unknown>)))

const cloneForSelect = <T>(value: T): T => value === undefined || value === null ? value : structuredClone(value)

const applyIncludeSelect = (value: unknown, select: unknown): unknown => {
  if (select === true) return cloneForSelect(value)
  if (!value || !select || typeof select !== 'object' || Array.isArray(select)) return undefined

  if (Array.isArray(value)) {
    return value.map((item) => applyIncludeSelect(item, select)).filter((item) => item !== undefined)
  }

  if (typeof value !== 'object') return cloneForSelect(value)

  const source = value as Record<string, unknown>
  if ('en' in source && !('relationTo' in source && 'value' in source) && !Object.prototype.hasOwnProperty.call(select as Record<string, unknown>, 'en')) {
    const localized = Object.fromEntries(
      Object.entries(source)
        .map(([locale, localeValue]) => [locale, applyIncludeSelect(localeValue, select)])
        .filter(([, localeValue]) => localeValue !== undefined),
    )
    return Object.keys(localized).length ? localized : undefined
  }

  const output: Record<string, unknown> = {}

  if (source.id !== undefined) output.id = source.id
  if (source.blockType !== undefined) output.blockType = source.blockType

  for (const [key, nestedSelect] of Object.entries(select as Record<string, unknown>)) {
    if (key in source) {
      const nested = applyIncludeSelect(source[key], nestedSelect)
      if (nested !== undefined) output[key] = nested
      continue
    }

    if (source.blockType === key) {
      const nested = applyIncludeSelect(source, nestedSelect)
      if (nested && typeof nested === 'object') Object.assign(output, nested)
    }
  }

  return Object.keys(output).length ? output : undefined
}

const applyExcludeSelect = (value: unknown, select: unknown): unknown => {
  if (select === false) return undefined
  if (!value || !select || typeof select !== 'object' || Array.isArray(select)) return cloneForSelect(value)

  if (Array.isArray(value)) {
    return value.map((item) => applyExcludeSelect(item, select)).filter((item) => item !== undefined)
  }

  if (typeof value !== 'object') return cloneForSelect(value)

  const output = cloneForSelect(value) as Record<string, unknown>
  if ('en' in output && !('relationTo' in output && 'value' in output) && !Object.prototype.hasOwnProperty.call(select as Record<string, unknown>, 'en')) {
    return Object.fromEntries(
      Object.entries(output).map(([locale, localeValue]) => [locale, applyExcludeSelect(localeValue, select)]),
    )
  }

  for (const [key, nestedSelect] of Object.entries(select as Record<string, unknown>)) {
    if (key in output) {
      const nested = applyExcludeSelect(output[key], nestedSelect)
      if (nested === undefined) delete output[key]
      else output[key] = nested
      continue
    }

    if (output.blockType === key) {
      if (nestedSelect === false) {
        for (const fieldKey of Object.keys(output)) {
          if (fieldKey !== 'id' && fieldKey !== 'blockType') delete output[fieldKey]
        }
      } else {
        const nested = applyExcludeSelect(output, nestedSelect)
        if (nested && typeof nested === 'object') {
          for (const existingKey of Object.keys(output)) delete output[existingKey]
          Object.assign(output, nested)
        }
      }
    }
  }

  return output
}

export const applySelect = <T extends Record<string, unknown> | null>(doc: T, select?: Record<string, unknown>): T => {
  if (!doc || !select || Object.keys(select).length === 0) {
    return doc
  }

  if (!hasTruthySelect(select)) {
    return applyExcludeSelect(doc, select) as T
  }

  const projected = applyIncludeSelect(doc, select)
  return (projected && typeof projected === 'object' ? projected : { id: doc.id }) as T
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
