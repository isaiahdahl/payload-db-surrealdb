import { literal } from '../utilities/sql.js';
const pathToSQL = (path) => {
    if (path === 'id') {
        return 'meta::id(id)';
    }
    return path.split('.').map((part) => `.${part}`).join('').slice(1);
};
const valueToSQL = (value) => literal(value);
const operatorToSQL = (field, operator, value) => {
    const path = pathToSQL(field);
    switch (operator) {
        case 'equals':
            return `${path} = ${valueToSQL(value)}`;
        case 'not_equals':
            return `${path} != ${valueToSQL(value)}`;
        case 'greater_than':
            return `${path} > ${valueToSQL(value)}`;
        case 'greater_than_equal':
            return `${path} >= ${valueToSQL(value)}`;
        case 'less_than':
            return `${path} < ${valueToSQL(value)}`;
        case 'less_than_equal':
            return `${path} <= ${valueToSQL(value)}`;
        case 'in':
            return `${path} IN ${valueToSQL(value)}`;
        case 'not_in':
            return `${path} NOT IN ${valueToSQL(value)}`;
        case 'exists':
            return value ? `${path} != NONE` : `${path} = NONE`;
        case 'like':
        case 'contains':
            return `string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(value)})`;
        case 'not_like':
            return `!(string::lowercase(<string>${path}) CONTAINS string::lowercase(${valueToSQL(value)}))`;
        default:
            return `${path} = ${valueToSQL(value)}`;
    }
};
export const buildWhere = (where) => {
    if (!where || Object.keys(where).length === 0) {
        return '';
    }
    const clauses = Object.entries(where).flatMap(([key, value]) => {
        if (key === 'and' && Array.isArray(value)) {
            return [`(${value.map((entry) => buildWhere(entry).replace(/^WHERE /, '')).join(' AND ')})`];
        }
        if (key === 'or' && Array.isArray(value)) {
            return [`(${value.map((entry) => buildWhere(entry).replace(/^WHERE /, '')).join(' OR ')})`];
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.entries(value).map(([operator, operatorValue]) => operatorToSQL(key, operator, operatorValue));
        }
        return [`${pathToSQL(key)} = ${valueToSQL(value)}`];
    });
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
};
