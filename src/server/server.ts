// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import Fastify from "fastify";
import path from "path";
import fs from "fs";
import { ClientMux } from "../client_mux";
import { ClientOptions } from "../clients/common";
import { ProviderID } from "../models";
import { Provider, ModelID, ModelMetadata } from "../models";
import { version } from "../../package.json";
import { AgentOptions } from "../agent";
import { Registry } from "../registry";
import { Session } from "../session";
import { generateSchemas } from "../ts-gen/gen";
import moment from "moment";
import chalk from "chalk";
import child_process from "child_process";
import chokidar from "chokidar";

import { pathToFileURL } from "url";

import log from "loglevel";

export interface ServerOptions {
  port?: number;
  keys: Partial<Record<ProviderID, string>>;
  imports?: string[];
  modelOptions?: Partial<Record<ModelID, ClientOptions>>;
}

const compileTypescript = async (outputDir: string) => {
  const start = moment();
  return new Promise<void>((resolve, reject) => {
    child_process.execFile(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsc", "--outDir", outputDir], {
        shell: process.platform === "win32",
      },
      (error, stdout, stderr) => {
        if (error) {
          log.error(chalk.red("Failed to compile typescript\n"));
          log.error(
            stdout
              .split("\n")
              .map((line) => `|\t${line}`)
              .join("\n")
          );
          log.error(
            stderr
              .split("\n")
              .map((line) => `|\t${line}`)
              .join("\n")
          );
          reject(error);
        } else {
          const elapsed = moment().diff(start);
          log.info(
            `${chalk.green("Compiled typescript")} ${chalk.gray(
              "(took " +
                moment.duration(elapsed).as("seconds").toFixed(2) +
                "s)"
            )}`
          );
          resolve();
        }
      }
    );
  });
};

const addIndexToPath = (filePath: string, js?: boolean): string => {
  // check if path is a directory
  const stats = fs.statSync(filePath);
  if (stats.isDirectory()) {
    return path.join(filePath, "index" + (js ? ".js" : ".ts"));
  }
  return filePath;
};

const computeFileLocationInCache = (
  filePath: string,
  cacheName?: string
): string => {
  const cacheDir = path.join(process.cwd(), cacheName || "cache");
  const relativePath = path.relative(process.cwd(), filePath);
  const result = path.join(cacheDir, relativePath).replace(".ts", ".js");

  // on windows, return file path (e.g. 'file:///C:/path/to/file.js')
  if (process.platform === "win32") {
    return pathToFileURL(result).toString();
  }
  
  return result;
};

const clearRequireCache = () => {
  for (const key in require.cache) {
    if (key.startsWith(process.cwd())) {
      delete require.cache[key];
    }
  }
};

const constructorsFromModule = (module: any): any[] => {
  const constructors = [];
  if (Array.isArray(module.default?.default)) {
    constructors.push(...module.default.default);
  } else if (Array.isArray(module.default)) {
    constructors.push(...module.default);
  } else if (Array.isArray(module.default.agents)) {
    constructors.push(...module.default.agents);
  } else {
    constructors.push(module.default);
  }
  return constructors;
};

const keysFromModule = (module: any): Record<ProviderID, string> => {
  if (module.ProviderApiKeys) {
    return module.ProviderApiKeys;
  }
  return {};
};

const modelsFromModule = (module: any): ModelMetadata[] => {
  if (module.Models) {
    return module.Models;
  }
  return [];
};

const modelsOptionsFromModule = (
  module: any
): Record<ModelID, ClientOptions> => {
  if (module.ModelOptions) {
    return module.ModelOptions;
  }
  return {};
};

const namespaceFromPackage = (imp: string): string => {
  const packageJsonPath = path.join(path.dirname(imp), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  return packageJson.name;
};

const handleImports = async (
  registry: Registry,
  imports: string[]
): Promise<
  [Record<ProviderID, string>, ModelMetadata[], Record<ModelID, ClientOptions>]
> => {
  let keys: Record<ProviderID, string> = {};
  let models: ModelMetadata[] = [];
  let modelOptions: Record<ModelID, ClientOptions> = {};
  try {
    await compileTypescript(path.join(process.cwd(), "cache"));
  } catch (e) {
    return [keys, models, modelOptions];
  }
  clearRequireCache();
  for (const impRaw of imports) {
    let imp = path.resolve(process.cwd(), impRaw);
    // if the path is a directory, select index.ts
    const indexed = addIndexToPath(imp);
    imp = indexed;
    imp = computeFileLocationInCache(imp);
    // add random query string to avoid caching
    imp += `?${Math.random().toString(36).substring(7)}`;

    log.info(`  imported ${chalk.cyan(path.relative(process.cwd(), indexed))}`);
    try {
      const module = await import(imp);
      if (!module.default) {
        throw new Error(`Module ${impRaw} has no default export`);
      }
      const constructors = constructorsFromModule(module);
      keys = { ...keys, ...keysFromModule(module) };
      models = [...models, ...modelsFromModule(module)];
      modelOptions = { ...modelOptions, ...modelsOptionsFromModule(module) };
      const namespace = namespaceFromPackage(impRaw);

      for (const constructor of constructors) {
        log.info(
          `    ${
            registry.has(namespace, constructor.name) ? "updated" : "registered"
          } agent ${chalk.cyan(constructor.name)}`
        );
        registry.register(namespace, constructor.name, constructor);
      }
    } catch (e: any) {
      log.warn(`Failed to import ${impRaw}: ${e.message}`);
      continue;
    }
  }

  return [keys, models, modelOptions];
};

export const startServer = async ({
  port,
  keys,
  imports,
  modelOptions,
}: ServerOptions) => {
  log.info(
    `\n😎 ${chalk.yellow(
      `Sagentic.ai Agent Framework`
    )}\n   dev server ${chalk.gray("v" + version)}\n`
  );

  console.log("Generating schemas...");
  await generateSchemas();

  const server = Fastify({ logger: true });

  const registry = new Registry();

  const [importedKeys, importedModels, importedModelOptions] =
    await handleImports(registry, imports || []);
  keys = { ...keys, ...importedKeys };
  modelOptions = { ...modelOptions, ...importedModelOptions };

  //TODO: add check for provider keys

  const sessions: Session[] = [];

  const clientMux = new ClientMux(
    keys,
    {
      models: importedModels,
    },
    modelOptions
  );
  clientMux.start();

  const watcher = chokidar.watch(process.cwd(), {
    ignoreInitial: true,
    ignored: [/node_modules/, /cache/, /dist/, "schemas.gen.ts"],
    cwd: process.cwd(),
  });

  let timer: NodeJS.Timeout | null = null;

  watcher.on("all", () => {
    // debounce
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(async () => {
      await generateSchemas();
      await handleImports(registry, imports || []);
    }, 1000);
  });

  server.get("/", async (_request, _reply) => {
    return {
      service: "sagentic.ai server",
      version,
      agents: registry.list(),
    };
  });

  server.get("/stat", async (_request, _reply) => {
    const response = {
      sessions: [] as any[],
    };

    for (const session of sessions) {
      response.sessions.push({
        cost: session.totalCost(),
        elapsed: session.metadata.timing.elapsed.asSeconds(),
        ended: session.isAborted,
        exchanges: session.getLedger().entries,
        tokensPerModel: session.getLedger().modelTokens,
        tokensPerAgent: session.getLedger().callerTokens,
      });
    }

    return response;
  });

  server.post<{
    Body: { type: string; options: AgentOptions; env?: Record<string, string> };
  }>("/spawn", async (request, _reply) => {
    const { type, options } = request.body;
    const constructor = registry.get(type);
    const session = new Session(clientMux, { context: request.body.env });
    sessions.push(session);
    const agent = session.spawnAgent(constructor, options);
    try {
      const result = await agent.run();
      session.abort();
      return { success: true, result, session: session.report() };
    } catch (e: any) {
      session.abort();
      _reply.code(500);
      return {
        success: false,
        error: e.message,
        session: session.report(),
        trace: e.stack,
      };
    }
  });

  const listenPort = port;

  server.listen({ port: listenPort, host: "localhost" }, (err, _address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }

    log.info(
      `\nListening on ${chalk.cyan(`http://localhost:${listenPort}`)}\n`
    );
  });
};
