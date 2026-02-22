/**
 * Re-export shim for backwards compatibility.
 * New code should import directly from ./storage/IStorage, ./storage/SQLiteStorage, etc.
 */
export type { IStorage, Model, ModelUsage, UsageLog, TaskLog } from "./storage/IStorage";
export { SQLiteStorage as ModelStore } from "./storage/SQLiteStorage";
export { StorageFactory } from "./storage/StorageFactory";
