import type { Where } from 'payload'

import { literal } from '../utilities/sql.js'

const pathToSQL = (path: string): string => {
  if (path === 'id') {
    return 'meta::id(id)'
  }

  return path.split('.').map((part) => `.${part}`).join('').slice(1)
}

const valueToSQL = (value: unknown): string => literal(value)

const operatorToSQL = (field: string, operator: string, value: unknown): string => {
  const path = pathToSQL(field)

  switch (operator) {
    case 'equals':
      return `${path} = ${valueToSQL(value)}`
    case 'not_equals':
      return `${path} != ${valueToSQL(value)}`
    case 'greater_than':
      return `${path} > ${valueToSQL(value)}`
    case 'greater_than_equal':
      return `${path} >= ${valueToSQL(value)}`
    case 'less_than':
      return `${path} < ${valueToSQL(value)}`
    case 'less_than_equal':
      return `${path} <= ${valueToSQL(value)}`
    case 'in':
      return `${path} IN ${valueToSQL(value)}`
    case 'not_in':
      return `${path} NOT IN ${valueToSQL(value)}`
    case 'exists':
      return value ? `${path} != NONE` : `${path} = NONE`
    case 'like':
    case 'contains':
      return `string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(value)})`
    case 'not_like':
      return `!(string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(value)}))`
    default:
      return `${path} = ${valueToSQL(value)}`
  }
}

const buildClause = (where?: Where): string => {
  if (!where || Object.keys(where).length === 0) {
    return ''
  }

  const clauses = Object.entries(where).flatMap(([key, value]) => {
    if (key === 'and' && Array.isArray(value)) {
      const nested = value.map((entry) => buildClause(entry as Where)).filter(Boolean)

      return nested.length ? [`(${nested.join(' AND ')})`] : []
    }

    if (key === 'or' && Array.isArray(value)) {
      const nested = value.map((entry) => buildClause(entry as Where)).filter(Boolean)

      return nested.length ? [`(${nested.join(' OR ')})`] : []
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>).map(([operator, operatorValue]) =>
        operatorToSQL(key, operator, operatorValue),
      )
    }

    return [`${pathToSQL(key)} = ${valueToSQL(value)}`]
  })

  return clauses.filter(Boolean).join(' AND ')
}

export const buildWhere = (where?: Where): string => {
  const clause = buildClause(where)

  return clause ? `WHERE ${clause}` : ''
}
