export class SurrealDBError extends Error {
    cause;
    code;
    duplicate = false;
    status;
    constructor(message, options = {}) {
        super(message);
        this.name = 'SurrealDBError';
        this.cause = options.cause;
        this.code = options.code;
        this.duplicate = Boolean(options.duplicate);
        this.status = options.status;
    }
}
const isDuplicateError = (value) => {
    const message = typeof value === 'string' ? value : JSON.stringify(value);
    return /already exists|duplicate|unique|index/i.test(message);
};
const isRetryableConflict = (value) => {
    const message = typeof value === 'string' ? value : JSON.stringify(value);
    return /transaction conflict|write conflict|can be retried/i.test(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parseJSON = async (response) => {
    const text = await response.text();
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new SurrealDBError(`SurrealDB returned invalid JSON: ${text.slice(0, 500)}`, {
            cause: error,
            status: response.status,
        });
    }
};
export const createClient = (adapter) => {
    const endpoint = `${adapter.url.replace(/\/$/, '')}/sql`;
    const auth = adapter.auth
        ? `Basic ${Buffer.from(`${adapter.auth.username}:${adapter.auth.password}`).toString('base64')}`
        : undefined;
    return {
        async query(sql, options = {}) {
            const maxAttempts = 5;
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? adapter.requestTimeoutMs ?? 30_000);
                let response;
                try {
                    response = await fetch(endpoint, {
                        body: sql,
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': 'application/surrealql',
                            'Surreal-DB': adapter.database,
                            'Surreal-NS': adapter.namespace,
                            ...(auth ? { Authorization: auth } : {}),
                        },
                        method: 'POST',
                        signal: controller.signal,
                    });
                }
                catch (error) {
                    throw new SurrealDBError(`Failed to connect to SurrealDB at ${endpoint}`, { cause: error });
                }
                finally {
                    clearTimeout(timeout);
                }
                if (!response.ok) {
                    const body = await response.text();
                    throw new SurrealDBError(`SurrealDB HTTP ${response.status}: ${body}`, {
                        duplicate: isDuplicateError(body),
                        status: response.status,
                    });
                }
                const statements = await parseJSON(response);
                const failed = statements.find((statement) => statement.status === 'ERR');
                if (failed) {
                    if (attempt < maxAttempts && isRetryableConflict(failed.result)) {
                        await sleep(10 * attempt);
                        continue;
                    }
                    throw new SurrealDBError(`SurrealDB query failed: ${JSON.stringify(failed.result)}`, {
                        cause: failed.result,
                        duplicate: isDuplicateError(failed.result),
                    });
                }
                return statements.at(-1)?.result;
            }
            throw new SurrealDBError('SurrealDB query failed after retrying transaction conflicts');
        },
    };
};
