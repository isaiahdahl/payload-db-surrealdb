export declare const acquirePayloadJobUpdateLock: (id: string) => Promise<() => void>;
export declare const retainPayloadJobUpdateLockForTransaction: (transactionID: string, release: () => void) => void;
export declare const releasePayloadJobUpdateLocksForTransaction: (transactionID: string) => void;
export declare const withPayloadJobUpdateLock: <T>(id: string, operation: () => Promise<T>) => Promise<T>;
