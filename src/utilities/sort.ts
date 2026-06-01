import { pathToSQL } from '../queries/buildWhere.js'

export const sortValues = (sort?: string | string[]): string[] => (Array.isArray(sort) ? sort : sort ? [sort] : [])
  .flatMap((value) => String(value).split(','))
  .filter((value) => value.trim())

const compareScalarValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

const getComparableValue = (value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value
  }

  const values = value.filter((item) => item !== null && item !== undefined)
  values.sort(compareScalarValues)

  return values[0]
}

const normalizeComparableValue = (value: unknown): unknown => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>

    if ('relationTo' in object && 'value' in object) {
      return { relationTo: object.relationTo, value: normalizeComparableValue(object.value) }
    }

    if ('id' in object) {
      return object.id
    }

    if ('en' in object) {
      return normalizeComparableValue(object.en)
    }
  }

  return value
}

export const compareValues = (a: unknown, b: unknown): number => compareScalarValues(getComparableValue(normalizeComparableValue(a)), getComparableValue(normalizeComparableValue(b)))

export const valuesEqual = (a: unknown, b: unknown): boolean => JSON.stringify(normalizeComparableValue(a)) === JSON.stringify(normalizeComparableValue(b))

export const getSortSQL = (sort?: string | string[]): string => {
  const values = sortValues(sort)

  if (!values.length) {
    return 'ORDER BY createdAt DESC'
  }

  const parts = values.map((sortValue) => {
    const direction = sortValue.startsWith('-') ? 'DESC' : 'ASC'
    const field = sortValue.replace(/^-|^\+/, '')

    return `${field === 'id' ? 'id' : pathToSQL(field)} ${direction}`
  })

  if (!values.some((value) => value.replace(/^-|^\+/, '') === 'createdAt')) {
    parts.push('createdAt DESC')
  }

  return `ORDER BY ${parts.join(', ')}`
}
