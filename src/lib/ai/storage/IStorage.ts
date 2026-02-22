/**
 * Unified async storage interface.
 * Implementations: SQLiteStorage (better-sqlite3) and MySQLStorage (mysql2).
 */

export type ModelUsage = {
  model: string;
  rpmUsed: number;
  tpmUsed: number;
  rpdUsed: number;
  tpdUsed: number;
};

export type Model = {
  name: string;
  origin: string;
  rank: number;
  description: string;
  enabled: boolean;
  rpmAllowed: number;
  tpmTotal: number;
  rpdTotal: number;
  tpdTotal?: number;
  failedTasks?: number;
  successfulTasks?: number;
};

export type UsageLog = {
  id?: number;
  model: string;
  requests: number;
  tokens: number;
  timestamp: number;
};

export type TaskLog = {
  id?: number;
  model: string;
  taskType: string;
  success: boolean;
  errorMessage?: string;
  tokensUsed: number;
  timestamp: number;
};

export interface IStorage {
  seedModels(models: Model[]): Promise<void>;
  enableModel(name: string): Promise<void>;
  disableModel(name: string): Promise<void>;

  logModelUsage(model: string, requests?: number, tokens?: number): Promise<void>;
  getModelUsage(model: string): Promise<ModelUsage>;
  cleanupOldLogs(): Promise<number>;

  getAllAvailableModels(minTokens?: number): Promise<Model[]>;
  getModelStats(): Promise<Array<Model & ModelUsage>>;

  logTaskOutcome(
    model: string,
    taskType: string,
    success: boolean,
    tokensUsed: number,
    errorMessage?: string
  ): Promise<void>;
  getModelFailureRate(model: string, timeWindowSeconds?: number): Promise<number>;
  getRecentFailedTasks(model: string, limit?: number): Promise<TaskLog[]>;
  cleanupOldTaskLogs(daysToKeep?: number): Promise<number>;
}
