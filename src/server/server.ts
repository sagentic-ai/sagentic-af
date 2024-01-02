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

export interface ServerOptions {
  port?: number;
  openaiApiKey: string;
  imports?: string[];
}

const compileTypescript = async (outputDir: string) => {
  const { exec } = await import("child_process");

  const start = moment();
  return new Promise<void>((resolve, reject) => {
    exec(`npx tsc --outDir ${outputDir}`, (error, stdout, stderr) => {      
      if (error) {
        console.log(chalk.red("Failed to compile typescript\n"));
        console.log(stdout.split("\n").map((line) => `|\t${line}`).join("\n"));
        console.log(stderr.split("\n").map((line) => `|\t${line}`).join("\n"));
        reject(error);
      } else {
        const elapsed = moment().diff(start);
        console.log(`${chalk.green('Compiled typescript')} ${chalk.gray("(took " + moment.duration(elapsed).as('seconds').toFixed(2) + 's)')}`);
        resolve();
      }
    });
  });
};

const addIndexToPath = (filePath: string): string => {
  // check if path is a directory
  const stats = fs.statSync(filePath);
  if (stats.isDirectory()) {
    return path.join(filePath, "index.ts");
  }
  return filePath;
};

const computeFileLocationInCache = (filePath: string): string => {
  const cacheDir = path.join(process.cwd(), "cache");
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
    

    console.log(`import ${chalk.cyan(path.relative(process.cwd(), indexed))}`);
    try {
      const module = await import(imp);
      if (!module.default) {
        throw new Error(`Module ${impRaw} has no default export`);
      }
      const constructors = [];
      if (Array.isArray(module.default)) {
        constructors.push(...module.default);
      } else {
        constructors.push(module.default);
      }
      for (const constructor of constructors) {
        console.log(
          `  ${registry.has(constructor.name) ? "update" : "register"} agent ${
            chalk.cyan(constructor.name)
          }`
        );
        registry.register(constructor.name, constructor);
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

  console.log(`\n😎 ${chalk.yellow(`Bazed.ai Agent Framework`)}\n   dev server ${chalk.gray("v" + version)}\n`);


  const server = Fastify();

  const apiKey = openaiApiKey;

  if (!apiKey) {
    throw new Error("No OpenAI API key provided");
  }

  const clientMux = new ClientMux(apiKey);
  const registry = new Registry();

  await importAgents(registry, imports || []);

  fs.watch(
    process.cwd(),
    { recursive: true },
    async (action: fs.WatchEventType, filePath: string | null) => {
      // skip cache directory
      const cacheDir = path.join(process.cwd(), "cache");
      const absoluteFilePath = path.resolve(process.cwd(), filePath || "");

      if (absoluteFilePath.startsWith(cacheDir)) return;

      await importAgents(registry, imports || []);
    }
  );

  server.get("/", async (_request, _reply) => {
    return {
      service: "bazed.ai dev server",
      version,
      agents: registry.list(),
    };
  });

  server.post<{ Body: { type: string; options: AgentOptions } }>(
    "/spawn",
    async (request, _reply) => {
      const { type, options } = request.body;
      const constructor = registry.get(type);
      const session = new Session(clientMux, {});
      const agent = session.spawnAgent(constructor, options);
      try {
        const result = await agent.run();
        return { success: true, result, session: session.report() };
      } catch (e: any) {
        console.log(e);
        return { error: e.message, session: session.report() };
      } finally {
        session.abort();
      }
    }
  );

  const listenPort = port; //|| (await getPort({ port: portNumbers(3000, 3100) }));

  server.listen({ port: listenPort, host: "localhost" }, (err, _address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }

    console.log(`\nListening on ${chalk.cyan(`http://localhost:${listenPort}`)}\n`);
  });
};
