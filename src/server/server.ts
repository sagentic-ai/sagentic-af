// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
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
  platform?: boolean;
}

const compileTypescript = async (outputDir: string) => {
  const { exec } = await import("child_process");

  const start = moment();
  return new Promise<void>((resolve, reject) => {
    exec(`npx tsc --outDir ${outputDir}`, (error, stdout, stderr) => {
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
            "(took " + moment.duration(elapsed).as("seconds").toFixed(2) + "s)"
          )}`
        );
        resolve();
      }
    });
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

const namespaceFromModule = (module: any, defaultNamespace: string): string => {
  if (module.default.namespace) {
    return module.default.namespace;
  } else {
    return defaultNamespace;
  }
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

const importAgentsRaw = async (registry: Registry, imports: string[]) => {
  clearRequireCache();
  for (const impRaw of imports) {
    let imp = path.resolve(process.cwd(), impRaw);
    // if the path is a directory, select index.ts
    const indexed = addIndexToPath(imp, true);
    imp = indexed;
    //imp = computeFileLocationInCache(imp, "dist");

    console.log(`import ${chalk.cyan(path.relative(process.cwd(), indexed))}`);
    try {
      const module = await import(imp);
      if (!module.default) {
        throw new Error(`Module ${impRaw} has no default export`);
      }
      const constructors = constructorsFromModule(module);
      const namespace =
        "xiv/" + namespaceFromModule(module, path.basename(path.dirname(imp)));
      for (const constructor of constructors) {
        console.log(
          `  ${
            registry.has(namespace, constructor.name) ? "update" : "register"
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
  platform,
}: ServerOptions) => {
  console.log(
    `\n😎 ${chalk.yellow(
      `Bazed.ai Agent Framework`
    )}\n   dev server ${chalk.gray("v" + version)}\n`
  );

  const server = Fastify();

  const apiKey = openaiApiKey;

  if (!apiKey) {
    throw new Error("No OpenAI API key provided");
  }

  const sessions: Session[] = [];

  const clientMux = new ClientMux(apiKey);
  const registry = new Registry();

  if (!platform) {
    await importAgents(registry, imports || []);

    fs.watch(
      process.cwd(),
      { recursive: true },
      async (action: fs.WatchEventType, filePath: string | null) => {
        if (!filePath) return;

        // skip cache directory
        const cacheDir = path.join(process.cwd(), "cache");
        const distDir = path.join(process.cwd(), "dist");
        const absoluteFilePath = path.resolve(process.cwd(), filePath || "");

        if (absoluteFilePath.startsWith(cacheDir)) return;
        if (absoluteFilePath.startsWith(distDir)) return;
        if (filePath?.startsWith("node_modules")) return;

        await importAgents(registry, imports || []);
      }
    );
  }

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
      return { success: true, result, session: report(session) };
    } catch (e: any) {
      session.abort();
      return { error: e.message, session: report(session) };
    }
  });

  // After initializing your Fastify instance
  server.register(fastifyMultipart);

  server.post("/deploy", async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.send({ success: false });
      }
      const fileContent = await data.toBuffer();

      // save file to disk as project.zip
      const zipPath = path.join(process.cwd(), "project.zip");

      fs.writeFileSync(zipPath, fileContent);

      // unzip project.zip
      child_process.execSync(`unzip -o ${zipPath} -d ${process.cwd()}/project`);

      // remove project.zip
      fs.unlinkSync(zipPath);

      //run yarn in project/dist
      child_process.execSync(`cd ${process.cwd()}/project/dist && yarn`);

      // import agents
      await importAgentsRaw(registry, ["project/dist"]);

      return reply.send({ success: true });
    } catch (e) {
      console.log(e);
      return reply.send({ success: false });
    }
  });

  const report = (session: Session) => {
    const rep = {
      cost: session.totalCost(),
      tokens: {} as Record<string, number>,
      elapsed: session.metadata.timing.elapsed.asSeconds(),
    };
    for (const [model, cost] of Object.entries(session.report())) {
      if (cost.total > 0) {
        rep.tokens[model] = cost.total;
      }
    }
    return rep;
  };

  const listenPort = port; //|| (await getPort({ port: portNumbers(3000, 3100) }));

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
