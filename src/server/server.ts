// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import Fastify from "fastify";
import path from "path";
import fs from "fs";
import { ClientMux } from "../client";
import { version } from "../../package.json";
import { AgentOptions } from "../agent";
import { Registry } from "../registry";
import { Session } from "../session";
import moment from "moment";
import chalk from "chalk";
import child_process from "child_process";

export interface ServerOptions {
  port?: number;
  openaiApiKey: string;
  imports?: string[];
}

const compileTypescript = async (outputDir: string) => {
  const start = moment();
  return new Promise<void>((resolve, reject) => {
    child_process.execFile(
      "npx",
      ["tsc", "--outDir", outputDir],
      (error, stdout, stderr) => {
        if (error) {
          console.log(chalk.red("Failed to compile typescript\n"));
          console.log(
            stdout
              .split("\n")
              .map((line) => `|\t${line}`)
              .join("\n")
          );
          console.log(
            stderr
              .split("\n")
              .map((line) => `|\t${line}`)
              .join("\n")
          );
          reject(error);
        } else {
          const elapsed = moment().diff(start);
          console.log(
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
  return path.join(cacheDir, relativePath).replace(".ts", ".js");
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
  if (Array.isArray(module.default)) {
    constructors.push(...module.default);
  } else if (Array.isArray(module.default.agents)) {
    constructors.push(...module.default.agents);
  } else {
    constructors.push(module.default);
  }
  return constructors;
};

const namespaceFromPackage = (imp: string): string => {
  const packageJsonPath = path.join(path.dirname(imp), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  return packageJson.name;
};

const importAgents = async (registry: Registry, imports: string[]) => {
  try {
    await compileTypescript(path.join(process.cwd(), "cache"));
  } catch (e) {
    return;
  }
  clearRequireCache();
  for (const impRaw of imports) {
    let imp = path.resolve(process.cwd(), impRaw);
    // if the path is a directory, select index.ts
    const indexed = addIndexToPath(imp);
    imp = indexed;
    imp = computeFileLocationInCache(imp);

    console.log(
      `  imported ${chalk.cyan(path.relative(process.cwd(), indexed))}`
    );
    try {
      const module = await import(imp);
      if (!module.default) {
        throw new Error(`Module ${impRaw} has no default export`);
      }
      const constructors = constructorsFromModule(module);
      const namespace = namespaceFromPackage(impRaw);

      for (const constructor of constructors) {
        console.log(
          `    ${
            registry.has(namespace, constructor.name) ? "updated" : "registered"
          } agent ${chalk.cyan(constructor.name)}`
        );
        registry.register(namespace, constructor.name, constructor);
      }
    } catch (e: any) {
      console.log(`Failed to import ${impRaw}: ${e.message}`);
      continue;
    }
  }
};

export const startServer = async ({
  port,
  openaiApiKey,
  imports,
}: ServerOptions) => {
  console.log(
    `\n😎 ${chalk.yellow(
      `Bazed.ai Agent Framework`
    )}\n   dev server ${chalk.gray("v" + version)}\n`
  );

  const server = Fastify({ logger: true });

  const apiKey = openaiApiKey;

  if (!apiKey) {
    throw new Error("No OpenAI API key provided");
  }

  const sessions: Session[] = [];

  const clientMux = new ClientMux(apiKey);
  const registry = new Registry();

  await importAgents(registry, imports || []);

  fs.watch(
    process.cwd(),
    { recursive: true },
    async (action: fs.WatchEventType, filePath: string | null) => {
      if (!filePath) return;

      // skip cache directory
      const cwd = process.cwd();
      const cacheDir = path.join(cwd, "cache");
      const distDir = path.join(cwd, "dist");
      const absoluteFilePath = path.resolve(cwd, filePath || "");

      if (absoluteFilePath.startsWith(cacheDir)) return;
      if (absoluteFilePath.startsWith(distDir)) return;
      if (filePath?.startsWith("node_modules")) return;

      await importAgents(registry, imports || []);
    }
  );

  server.get("/", async (_request, _reply) => {
    return {
      service: "bazed.ai server",
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

    console.log(
      `\nListening on ${chalk.cyan(`http://localhost:${listenPort}`)}\n`
    );
  });
};
