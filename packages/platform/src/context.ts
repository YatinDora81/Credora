import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContext {
  application_id?: string;
  request_id: string;
  [key: string]: string | undefined;
}

export const als = new AsyncLocalStorage<LogContext>();

export function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function withContext<T>(store: Partial<LogContext>, fn: () => T): T {
  const parent = als.getStore();
  const merged: LogContext = {
    ...(parent ?? {}),
    ...store,
    request_id: store.request_id ?? parent?.request_id ?? newRequestId(),
  };
  return als.run(merged, fn);
}

export function setContext(patch: Partial<LogContext>): boolean {
  const store = als.getStore();
  if (!store) return false;
  Object.assign(store, patch);
  return true;
}
