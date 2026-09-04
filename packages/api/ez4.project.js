import { ArchitectureType, LogLevel, RuntimeType } from "@ez4/project";

const { APP_STAGE = "dev", APP_DEBUG, EZ4_RAW_PG_DB_URL } = process.env;

/** @type {import("@ez4/project").ProjectOptions} */
export default {
  prefix: APP_STAGE,
  debugMode: APP_DEBUG === "true",
  projectName: "receivy",
  sourceFiles: ["./src/api.ts"],
  stateFile: {
    path: `${APP_STAGE}-deploy`,
    remote: true,
  },
  serveOptions: {
    localPort: 3735,
  },
  localOptions: {
    db: EZ4_RAW_PG_DB_URL
      ? { connectionString: EZ4_RAW_PG_DB_URL }
      : {
          user: "receivy",
          password: "receivy",
          host: "127.0.0.1",
          port: 55434,
          database: "receivy",
        },
  },
  defaultOptions: {
    runtime: RuntimeType.Node24,
    architecture: ArchitectureType.Arm,
    logLevel: LogLevel.Information,
    logRetention: 30,
  },
  deployOptions: {
    release: {
      version: new Date().toISOString().substring(0, 10),
      tagName: "Version",
    },
  },
  tags: {
    Project: "Receivy",
    Stage: APP_STAGE,
  },
  variables: {
    APP_STAGE,
    APP_DEBUG,
  },
};
