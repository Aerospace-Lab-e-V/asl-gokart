/** Admin mode is checked and held by main; the new state arrives in `stores/session.ts`. */
export const admin = {
    /** Resolves to whether the PIN was right. */
    unlock: (pin: string) => window.api.admin.unlock(pin),
    lock: () => window.api.admin.lock(),
};
