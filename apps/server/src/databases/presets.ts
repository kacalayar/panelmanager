import { generatePassword } from "@panelmanager/db";

export type DatabaseEngine = "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

export interface DatabasePreset {
  kind: DatabaseEngine;
  image: string;
  defaultPort: number;
  dataTargetPath: string;
  cmd?: string[];
  buildEnv: (dbName: string, username: string, password: string) => Record<string, string>;
  buildConnectionUrl: (host: string, port: number, dbName: string, username: string, password: string) => string;
}

export const DATABASE_PRESETS: Record<DatabaseEngine, DatabasePreset> = {
  postgres: {
    kind: "postgres",
    image: "postgres:16-alpine",
    defaultPort: 5432,
    dataTargetPath: "/var/lib/postgresql/data",
    buildEnv: (dbName, username, password) => ({
      POSTGRES_DB: dbName,
      POSTGRES_USER: username,
      POSTGRES_PASSWORD: password,
    }),
    buildConnectionUrl: (host, port, dbName, username, password) =>
      `postgresql://${username}:${password}@${host}:${port}/${dbName}`,
  },
  mysql: {
    kind: "mysql",
    image: "mysql:8.4",
    defaultPort: 3306,
    dataTargetPath: "/var/lib/mysql",
    buildEnv: (dbName, username, password) => ({
      MYSQL_ROOT_PASSWORD: generatePassword(24),
      MYSQL_DATABASE: dbName,
      MYSQL_USER: username,
      MYSQL_PASSWORD: password,
    }),
    buildConnectionUrl: (host, port, dbName, username, password) =>
      `mysql://${username}:${password}@${host}:${port}/${dbName}`,
  },
  mariadb: {
    kind: "mariadb",
    image: "mariadb:11",
    defaultPort: 3306,
    dataTargetPath: "/var/lib/mysql",
    buildEnv: (dbName, username, password) => ({
      MARIADB_ROOT_PASSWORD: generatePassword(24),
      MARIADB_DATABASE: dbName,
      MARIADB_USER: username,
      MARIADB_PASSWORD: password,
    }),
    buildConnectionUrl: (host, port, dbName, username, password) =>
      `mysql://${username}:${password}@${host}:${port}/${dbName}`,
  },
  mongo: {
    kind: "mongo",
    image: "mongo:7",
    defaultPort: 27017,
    dataTargetPath: "/data/db",
    buildEnv: (_dbName, username, password) => ({
      MONGO_INITDB_ROOT_USERNAME: username,
      MONGO_INITDB_ROOT_PASSWORD: password,
    }),
    buildConnectionUrl: (host, port, _dbName, username, password) =>
      `mongodb://${username}:${password}@${host}:${port}/?authSource=admin`,
  },
  redis: {
    kind: "redis",
    image: "redis:7-alpine",
    defaultPort: 6379,
    dataTargetPath: "/data",
    cmd: ["sh", "-c", 'exec redis-server --requirepass "$REDIS_PASSWORD"'],
    buildEnv: (_dbName, _username, password) => ({
      REDIS_PASSWORD: password,
    }),
    buildConnectionUrl: (host, port, _dbName, _username, password) =>
      `redis://:${password}@${host}:${port}`,
  },
};

export function isDatabaseEngine(kind: string): kind is DatabaseEngine {
  return kind in DATABASE_PRESETS;
}
