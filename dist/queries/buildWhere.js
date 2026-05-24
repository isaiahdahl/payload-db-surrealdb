import { escapeIdent, literal } from '../utilities/sql.js';
const simpleIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const reservedIdentifiers = new Set(['select']);
export const pathToSQL = (path) => {
    path = path.replaceAll('__', '.');
    if (path === 'id') {
        return 'meta::id(id)';
    }
    return path
        .split('.')
        .filter(Boolean)
        .map((part) => (simpleIdentifier.test(part) && !reservedIdentifiers.has(part.toLowerCase()) ? part : escapeIdent(part)))
        .join('.');
};
const valueToSQL = (value) => literal(value);
const coerceValue = (field, value) => {
    if (value === 'null')
        return null;
    if (field?.type === 'number') {
        if (Array.isArray(value)) {
            return value.map((item) => (typeof item === 'string' && item.trim() !== '' && !Number.isNaN(Number(item)) ? Number(item) : item));
        }
        if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
            return Number(value);
        }
    }
    if ((field?.type === 'checkbox' || typeof value === 'string') && (value === 'true' || value === 'false')) {
        return value === 'true';
    }
    return value;
};
const getFieldConfig = (fields, path) => {
    const segments = path.replaceAll('__', '.').split('.').filter(Boolean);
    const walk = (currentFields, index) => {
        if (!currentFields || index >= segments.length)
            return undefined;
        for (const field of currentFields) {
            if (field.name === segments[index]) {
                if (index === segments.length - 1)
                    return field;
                if (field.fields) {
                    const match = walk(field.fields, index + 1);
                    if (match)
                        return match;
                }
                if (field.tabs) {
                    for (const tab of field.tabs) {
                        const nextIndex = tab.name === segments[index + 1] ? index + 2 : index + 1;
                        const match = walk(tab.fields, nextIndex);
                        if (match)
                            return match;
                    }
                }
                if (field.blocks) {
                    for (const block of field.blocks) {
                        const match = walk(block.fields, index + 1);
                        if (match)
                            return match;
                    }
                }
            }
            if (!field.name && field.fields) {
                const match = walk(field.fields, index);
                if (match)
                    return match;
            }
        }
        return undefined;
    };
    return walk(fields, 0);
};
const isHasManyRelationship = (field) => Boolean(field?.hasMany && (field.type === 'relationship' || field.type === 'upload'));
const operatorToSQL = (field, operator, value, fields) => {
    const path = pathToSQL(field);
    const fieldConfig = getFieldConfig(fields, field);
    const listValue = (operator === 'in' || operator === 'not_in') && typeof value === 'string'
        ? value.split(',').map((item) => item.trim()).filter(Boolean)
        : value;
    const normalizedValue = field === 'id' ? (Array.isArray(listValue) ? listValue.map(String) : String(listValue)) : coerceValue(fieldConfig, listValue);
    if (fieldConfig?.hasMany) {
        switch (operator) {
            case 'equals':
            case 'contains':
                return Array.isArray(normalizedValue)
                    ? `${path} CONTAINSANY ${valueToSQL(normalizedValue)}`
                    : `${path} CONTAINS ${valueToSQL(normalizedValue)}`;
            case 'not_equals':
            case 'not_contains':
                return Array.isArray(normalizedValue)
                    ? `!(${path} CONTAINSANY ${valueToSQL(normalizedValue)})`
                    : `!(${path} CONTAINS ${valueToSQL(normalizedValue)})`;
            case 'in':
                return `array::len(array::intersect(${path} ?? [], ${valueToSQL(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue])})) > 0`;
            case 'not_in':
                return `array::len(array::intersect(${path} ?? [], ${valueToSQL(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue])})) = 0`;
        }
    }
    switch (operator) {
        case 'equals':
            return normalizedValue === null ? `(${path} = NONE OR ${path} = NULL)` : `${path} = ${valueToSQL(normalizedValue)}`;
        case 'not_equals':
            return normalizedValue === null ? `(${path} != NONE AND ${path} != NULL)` : `${path} != ${valueToSQL(normalizedValue)}`;
        case 'greater_than':
            return `${path} > ${valueToSQL(normalizedValue)}`;
        case 'greater_than_equal':
            return `${path} >= ${valueToSQL(normalizedValue)}`;
        case 'less_than':
            return `${path} < ${valueToSQL(normalizedValue)}`;
        case 'less_than_equal':
            return `${path} <= ${valueToSQL(normalizedValue)}`;
        case 'in':
            return `${path} IN ${valueToSQL(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue])}`;
        case 'not_in':
            return `${path} NOT IN ${valueToSQL(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue])}`;
        case 'exists':
            return normalizedValue ? `(${path} != NONE AND ${path} != NULL)` : `(${path} = NONE OR ${path} = NULL)`;
        case 'like': {
            const words = String(normalizedValue ?? '').split(/\s+/).filter(Boolean);
            return words.length
                ? words.map((word) => `string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(word)})`).join(' AND ')
                : `string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(normalizedValue)})`;
        }
        case 'contains':
            return `string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(normalizedValue)})`;
        case 'not_like':
            return `!(string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(normalizedValue)}))`;
        default:
            return `${path} = ${valueToSQL(normalizedValue)}`;
    }
};
const unsafeJSONValue = /select\(|["'\\=]/i;
const assertSafeQueryValue = (key, value) => {
    if (!key.startsWith('json.')) {
        return;
    }
    if (typeof value === 'string' && unsafeJSONValue.test(value)) {
        throw new Error(`Unsafe query value for ${key}`);
    }
};
const buildClause = (where, fields) => {
    if (!where || Object.keys(where).length === 0) {
        return '';
    }
    const clauses = Object.entries(where).flatMap(([key, value]) => {
        const normalizedKey = key.toLowerCase();
        if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value)) {
            const joiner = normalizedKey === 'and' ? ' AND ' : ' OR ';
            const nested = value.map((entry) => buildClause(entry, fields)).filter(Boolean);
            return nested.length ? [`(${nested.join(joiner)})`] : [];
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.entries(value).map(([operator, operatorValue]) => {
                assertSafeQueryValue(key, operatorValue);
                return operatorToSQL(key, operator, operatorValue, fields);
            });
        }
        assertSafeQueryValue(key, value);
        return [`${pathToSQL(key)} = ${valueToSQL(coerceValue(getFieldConfig(fields, key), value))}`];
    });
    return clauses.filter(Boolean).join(' AND ');
};
export const buildWhere = (where, fields) => {
    const clause = buildClause(where, fields);
    return clause ? `WHERE ${clause}` : '';
};
