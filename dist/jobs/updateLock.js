const locks = new Map();
export const withPayloadJobUpdateLock = async (id, operation) => {
    const previous = locks.get(id) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    locks.set(id, previous.then(() => current, () => current));
    await previous.catch(() => undefined);
    try {
        return await operation();
    }
    finally {
        release();
        if (locks.get(id) === current) {
            locks.delete(id);
        }
    }
};
