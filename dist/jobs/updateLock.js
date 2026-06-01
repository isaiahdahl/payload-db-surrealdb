const locks = new Map();
const transactionLockReleases = new Map();
export const acquirePayloadJobUpdateLock = async (id) => {
    const previous = locks.get(id) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    locks.set(id, previous.then(() => current, () => current));
    await previous.catch(() => undefined);
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        release();
        if (locks.get(id) === current) {
            locks.delete(id);
        }
    };
};
export const retainPayloadJobUpdateLockForTransaction = (transactionID, release) => {
    transactionLockReleases.set(transactionID, [
        ...(transactionLockReleases.get(transactionID) ?? []),
        release,
    ]);
};
export const releasePayloadJobUpdateLocksForTransaction = (transactionID) => {
    const releases = transactionLockReleases.get(transactionID) ?? [];
    transactionLockReleases.delete(transactionID);
    for (const release of releases) {
        release();
    }
};
export const withPayloadJobUpdateLock = async (id, operation) => {
    const release = await acquirePayloadJobUpdateLock(id);
    try {
        return await operation();
    }
    finally {
        release();
    }
};
