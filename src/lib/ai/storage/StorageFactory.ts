import * as fs from "fs";
import * as path from "path";
import { IStorage } from "./IStorage";
import { SQLiteStorage } from "./SQLiteStorage";
import { MySQLStorage } from "./MySQLStorage";

/**
 * Creates the storage adapter based on config.json (root) and environment variables.
 *
 * Driver resolution order (env > config.json > default):
 *   DB_DRIVER=sqlite|mysql|mariadb
 *
 * SQLite: DB_PATH (optional, defaults to config or "src/lib/ai/db.sqlite")
 * MySQL/MariaDB: DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
 */
export class StorageFactory {
  static create(): IStorage {
    const cfg = StorageFactory.loadConfig();
    const driver = (
      process.env.DB_DRIVER ||
      cfg.storage?.driver ||
      "sqlite"
    ).toLowerCase();

    switch (driver) {
      case "sqlite": {
        const dbPath =
          process.env.DB_PATH || cfg.storage?.sqlite?.path || "data/db.sqlite";
        console.log(`✓ Storage: SQLite (${dbPath})`);
        return new SQLiteStorage(dbPath);
      }

      case "mysql":
      case "mariadb": {
        const mysqlCfg = cfg.storage?.mysql ?? {};
        const config = {
          host: process.env.DB_HOST || mysqlCfg.host || "localhost",
          port: Number(process.env.DB_PORT || mysqlCfg.port || 3306),
          user: process.env.DB_USER || mysqlCfg.user || "",
          password: process.env.DB_PASS || mysqlCfg.password || "",
          database: process.env.DB_NAME || mysqlCfg.database || "mjxassistant",
        };
        console.log(`✓ Storage: ${driver} (${config.host}:${config.port}/${config.database})`);
        return new MySQLStorage(config);
      }

      default:
        throw new Error(
          `Unknown storage driver "${driver}". Valid options: sqlite, mysql, mariadb`
        );
    }
  }

  private static loadConfig(): any {
    try {
      const configPath = path.join(process.cwd(), "config.json");
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      return {};
    }
  }
}
