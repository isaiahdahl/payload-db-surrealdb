import type { Where } from 'payload'

import { escapeIdent, literal } from '../utilities/sql.js'

type Field = {
  hasMany?: boolean
  name?: string
  type?: string
}

const simpleIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/

export const pathToSQL = (path: string): string => {
  path = path.replaceAll('__', '.')
  if (path === 'id') {
    return 'meta::id(id)'
  }

  return path
    .split('.')
    .filter(Boolean)
    .map((part) => (simpleIdentifier.test(part) ? part : escapeIdent(part)))
    .join('.')
}

const valueToSQL = (value: unknown): string => literal(value)

const coerceValue = (field: Field | undefined, value: unknown): unknown => {
  if (field?.type === 'number') {
    if (Array.isArray(value)) {
      return value.map((item) => (typeof item === 'string' && item.trim() !== '' && !Number.isNaN(Number(item)) ? Number(item) : item))
    }
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value)
    }
  }

  if ((field?.type === 'checkbox' || typeof value === 'string') && (value === 'true' || value === 'false')) {
    return value === 'true'
  }

  return value
}

const getFieldConfig = (fields: Field[] | undefined, path: string): Field | undefined => {
  const root = path.split('.')[0]

  return fields?.find((field) => field.name === root)
}

const isHasManyRelationship = (field?: Field): boolean =>
  Boolean(field?.hasMany && (field.type === 'relationship' || field.type === 'upload'))

const operatorToSQL = (field: string, operator: string, value: unknown, fields?: Field[]): string => {
  const path = pathToSQL(field)
  const fieldConfig = getFieldConfig(fields, field)
  const listValue = (operator === 'in' || operator === 'not_in') && typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : value
  const normalizedValue = field === 'id' ? (Array.isArray(listValue) ? listValue.map(String) : String(listValue)) : coerceValue(fieldConfig, listValue)

  if (fieldConfig?.hasMany) {
    switch (operator) {
      case 'equals':
      case 'contains':
        return `${path} CONTAINS ${valueToSQL(normalizedValue)}`
      case 'not_equals':
      case 'not_contains':
        return `!(${path} CONTAINS ${valueToSQL(normalizedValue)})`
      case 'in':
        return `array::len(array::intersect(${path}, ${valueToSQL(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue])})) > 0`
      case 'not_in':
        return `array::len(array::intersect(${path}, ${valueToSQL(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue])})) = 0`
    }
  }

  switch (operator) {
    case 'equals':
      return normalizedValue === null ? `(${path} = NONE OR ${path} = NULL)` : `${path} = ${valueToSQL(normalizedValue)}`
    case 'not_equals':
      return normalizedValue === null ? `(${path} != NONE AND ${path} != NULL)` : `${path} != ${valueToSQL(normalizedValue)}`
    case 'greater_than':
      return `${path} > ${valueToSQL(normalizedValue)}`
    case 'greater_than_equal':
      return `${path} >= ${valueToSQL(normalizedValue)}`
    case 'less_than':
      return `${path} < ${valueToSQL(normalizedValue)}`
    case 'less_than_equal':
      return `${path} <= ${valueToSQL(normalizedValue)}`
    case 'in':
      return `${path} IN ${valueToSQL(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue])}`
    case 'not_in':
      return `${path} NOT IN ${valueToSQL(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue])}`
    case 'exists':
      return normalizedValue ? `${path} != NONE` : `${path} = NONE`
    case 'like': {
      const words = String(normalizedValue ?? '').split(/\s+/).filter(Boolean)
      return words.length
        ? words.map((word) => `string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(word)})`).join(' AND ')
        : `string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(normalizedValue)})`
    }
    case 'contains':
      return `string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(normalizedValue)})`
    case 'not_like':
      return `!(string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(normalizedValue)}))`
    default:
      return `${path} = ${valueToSQL(normalizedValue)}`
  }
}

const buildClause = (where?: Where, fields?: Field[]): string => {
  if (!where || Object.keys(where).length === 0) {
    return ''
  }

  const clauses = Object.entries(where).flatMap(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value)) {
      const joiner = normalizedKey === 'and' ? ' AND ' : ' OR '
      const nested = value.map((entry) => buildClause(entry as Where, fields)).filter(Boolean)

      return nested.length ? [`(${nested.join(joiner)})`] : []
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>).map(([operator, operatorValue]) =>
        operatorToSQL(key, operator, operatorValue, fields),
      )
    }

    return [`${pathToSQL(key)} = ${valueToSQL(coerceValue(getFieldConfig(fields, key), value))}`]
  })

  return clauses.filter(Boolean).join(' AND ')
}

export const buildWhere = (where?: Where, fields?: Field[]): string => {
  const clause = buildClause(where, fields)

  return clause ? `WHERE ${clause}` : ''
}
