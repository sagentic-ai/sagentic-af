#!/usr/bin/env node
// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import Path from "path";
import FS from "fs";
import { Command } from "commander";
import { version } from "../package.json";
import prompts from "prompts";
import chalk from "chalk";
import { startServer } from "../src/server/server";
import { BuiltinProvider, BuiltinModel, ModelID } from "../src/models";
import { SessionReport } from "../src/session";
import dotenv from "dotenv";
import axios, { AxiosResponse } from "axios";
import FormData from "form-data";
import { SingleBar } from "cli-progress";
import tar from "tar";
import moment from "moment";
import { getToolInterface } from "../src/tool";
import zodToJsonSchema from "zod-to-json-schema";
import { cliTable } from "./utils";
import { lockDeps, getLocalDeps, checkDeps } from "./lock-deps";
import log from "loglevel";

dotenv.config();

const PACKAGE_PATH = Path.resolve(__dirname, "..");
const PACKAGE_NAME = "@sagentic-ai/sagentic-af";
const PACKAGE_VERSION = version;

const LOGLEVEL = process.env.LOGLEVEL || "info";
log.setLevel(LOGLEVEL as log.LogLevelDesc);

const SAGENTIC_API_KEY = process.env.SAGENTIC_API_KEY;
const SAGENTIC_API_URL =
  process.env.SAGENTIC_API_URL || "https://p.sagentic.ai";

const banner = () => {
  console.log(
    `\n😎 ${chalk.yellow(`Sagentic.ai Agent Framework`)} ${chalk.gray(
      "v" + version
    )}\n`
  );
};

const outro = (pm: "yarn" | "npm", projectPath: string) => {
  const installCommand = pm === "yarn" ? "yarn" : "npm install";
  const runCommand = pm === "yarn" ? "yarn dev" : "npm run dev";

  const relativePath = Path.relative(process.cwd(), projectPath);

  const cdCommand = relativePath.length === 0 ? "" : `cd ${relativePath}`;

  let i = 1;

  const relativeStep =
    cdCommand.length === 0
      ? ""
      : `${i++}. Enter your project directory:\n
  ${chalk.cyan(cdCommand)}\n`;

  console.log(`\n🙌 ${chalk.yellow("You're all set!")}\n
${chalk.bold("Next steps")}\n
${relativeStep}
${i++}. Set your OpenAI API key in the ${chalk.cyan(".env")} file.\n
  ${chalk.cyan("OPENAI_API_KEY=sk-...")}\n
${i++}. Set your Sagentic AI API key in the ${chalk.cyan(".env")} file.\n
  ${chalk.cyan("SAGENTIC_API_KEY=...")}\n
${i++}. Install dependencies:\n
  ${chalk.cyan(installCommand)}\n
${i++}. Start the development server:\n
  ${chalk.cyan(runCommand)}\n`);
};

const copyTemplate = (
  templateName: string,
  targetPath: string,
  variables: Record<string, string>
) => {
  try {
    // recursively copy all files from the template folder to the target path
    const templatePath = Path.join(PACKAGE_PATH, "templates", templateName);
    const files = FS.readdirSync(templatePath);
    for (const file of files) {
      const filePath = Path.join(templatePath, file);
      const targetFilePath = Path.join(targetPath, file);
      const stat = FS.statSync(filePath);
      if (stat.isDirectory()) {
        FS.mkdirSync(targetFilePath);
        copyTemplate(Path.join(templateName, file), targetFilePath, variables);
      } else {
        let content = FS.readFileSync(filePath, "utf-8");
        for (const key in variables) {
          content = content.replace(
            new RegExp(`{{${key}}}`, "g"),
            variables[key]
          );
        }
        FS.writeFileSync(targetFilePath, content);
      }
    }
  } catch (e: any) {
    log.error("Error copying template", e.message);
    throw e;
  }
};

const copySrcTemplate = (
  templateName: string,
  targetPath: string,
  variables: Record<string, string>
) => {
  try {
    const templatePath = Path.join(PACKAGE_PATH, "templates", templateName);
    let content = FS.readFileSync(templatePath, "utf-8");
    for (const key in variables) {
      content = content.replace(new RegExp(`${key}`, "g"), variables[key]);
    }
    FS.writeFileSync(targetPath, content);
  } catch (e: any) {
    log.error("Error copying src template", e.message);
    throw e;
  }
};

const toPascalCase = (name: string): string => {
  return name
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
};

const toKebabCase = (name: string): string => {
  return name
    .split(/(?=[A-Z])/)
    .map((word) => word.toLowerCase())
    .join("-");
};

const toCamelCase = (name: string): string => {
  return name
    .split("-")
    .map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join("");
};

const program = new Command();

program
  .name("sagentic")
  .version(version)
  .description("😎 Sagentic Agent Framework CLI");

interface InitOptions {
  name?: string;
}

program
  .command("init")
  .argument("[path]", "Path to the project", ".")
  .option("-n, --name <name>", "Name of the project")
  .description("Initialize a new project")
  .action(async (path: string, options: InitOptions) => {
    try {
      banner();
      const fullPath = Path.resolve(process.cwd(), path);
      const basename = Path.basename(fullPath);
      const targetPathExists = FS.existsSync(fullPath);

      // if the name is not specified use the basename of the path
      let name = options.name || basename;

      // if path doesn't exist, create it
      if (!targetPathExists) {
        log.warn(`Directory ${chalk.blue(path)} doesn't exist.`);
        const { ok } = await prompts({
          type: "confirm",
          name: "ok",
          initial: true,
          message: `Create ${chalk.blue(path)} directory?`,
        });
        if (!ok) {
          program.error("Aborting", { exitCode: 1 });
        }
        FS.mkdirSync(fullPath);
      }

      // pick or confirm a name
      const { name: newName } = await prompts({
        type: "text",
        name: "name",
        message: "Project name:",
        initial: name,
      });
      name = newName;

      // create the project
      const variables = {
        NAME: name,
        SAGENTIC_PACKAGE: PACKAGE_NAME,
        SAGENTIC_VERSION: PACKAGE_VERSION,
      };
      copyTemplate("project", fullPath, variables);
      outro("yarn", fullPath);
    } catch (e: any) {
      program.error(`Aborting due to an error: ${e.message}`, { exitCode: 1 });
    }
  });

const commandNew = program
  .command("new")
  .description("Scaffold agents and tools");

const addExport = (path: string, name: string, importPath: string) => {
  try {
    const content = FS.readFileSync(path, "utf-8");
    const lines = content.split("\n");
    const lastImport = lines.findIndex((line) => line.startsWith("import"));
    lines.splice(lastImport + 1, 0, `import ${name} from "./${importPath}";`);

    const exportIndex = lines.findIndex((line) => line.startsWith("export"));
    lines.splice(exportIndex + 1, 0, `  ${name},`);

    FS.writeFileSync(path, lines.join("\n"));
  } catch (e: any) {
    log.error("Error adding export", e.message);
    throw e;
  }
};

commandNew
  .command("agent")
  .argument("<name>", "Name of the new agent")
  .argument("[type]", "Type of the new agent", "reactive")
  .description("Scaffold a new agent")
  .action(async (name: string, type: string) => {
    try {
      const fullPath = Path.join(
        process.cwd(),
        "agents",
        toKebabCase(name) + ".ts"
      );
      copySrcTemplate(`agents/${type}.ts`, fullPath, {
        Example: toPascalCase(name),
        SAGENTIC_PACKAGE: PACKAGE_NAME,
        SAGENTIC_VERSION: PACKAGE_VERSION,
      });
      addExport(
        Path.join(process.cwd(), "index.ts"),
        toPascalCase(name),
        `agents/${toKebabCase(name)}`
      );
    } catch (e: any) {
      program.error(`Aborting due to an error: ${e.message}`, { exitCode: 1 });
    }
  });

commandNew
  .command("tool")
  .argument("<name>", "Name of the new tool")
  .description("Scaffold a new tool")
  .action((name: string) => {
    try {
      const fullPath = Path.join(process.cwd(), "tools", toKebabCase(name));
      const type = "tool";
      copySrcTemplate(`tools/${type}.ts`, fullPath, {
        example: toCamelCase(name),
        SAGENTIC_PACKAGE: PACKAGE_NAME,
        SAGENTIC_VERSION: PACKAGE_VERSION,
      });
    } catch (e: any) {
      program.error(`Aborting due to an error: ${e.message}`, { exitCode: 1 });
    }
  });

program
  .command("run")
  .description("Run a project")
  .arguments("[importPaths...]")
  .action(async (importPaths: string[], _options: object) => {
    try {
      if (importPaths.length === 0) {
        importPaths = ["."];
      }
      await startServer({
        port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
        keys: {
          [BuiltinProvider.OpenAI]: process.env.OPENAI_API_KEY,
          [BuiltinProvider.AzureOpenAI]: process.env.AZURE_OPENAI_API_KEY,
          [BuiltinProvider.Google]: process.env.GOOGLE_API_KEY,
          [BuiltinProvider.Anthropic]: process.env.ANTHROPIC_API_KEY,
        },
        imports: importPaths,
        modelOptions: {
          [BuiltinModel.AZURE_GPT4o]: {
            resource: process.env.AZURE_OPENAI_RESOURCE_NAME,
            deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
          },
          [BuiltinModel.AZURE_GPT4oMini]: {
            resource: process.env.AZURE_OPENAI_RESOURCE_NAME,
            deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
          },
        },
      });
    } catch (e: any) {
      program.error(`Aborting due to an error: ${e.message}`, { exitCode: 1 });
    }
  });

const tarProject = (path: string): Promise<[string, () => void]> => {
  return new Promise((resolve, reject) => {
    const tmpDir = FS.mkdtempSync("sagentic-");
    const tarPath = Path.join(tmpDir, "dist.tar");
    tar
      .c(
        {
          gzip: true,
          file: tarPath,
          cwd: path,
        },
        ["dist"]
      )
      .then(() => {
        resolve([tarPath, () => FS.rmSync(tmpDir, { recursive: true })]);
      })
      .catch((e) => {
        reject(e);
      });
  });
};

const checkAPIKey = async (): Promise<boolean> => {
  if (!SAGENTIC_API_KEY) {
    log.error(
      `No ${chalk.cyan(
        "SAGENTIC_API_KEY"
      )} environment variable found. Please set your API key.`
    );
    return false;
  }
  const url = `${SAGENTIC_API_URL}/ping`;
  const headers = {
    Authorization: `Bearer ${SAGENTIC_API_KEY}`,
  };
  try {
    const response = await axios.get(url, { headers });
    if (response.data === "pong") {
      return true;
    }
  } catch (e) {
    log.error("Error when checking SAGENTIC_API_KEY", e);
  }
  return false;
};

const constructorsFromModule = (module: any): any[] => {
  try {
    const constructors = [];
    if (Array.isArray(module.default)) {
      constructors.push(...module.default);
    } else if (Array.isArray(module.default.agents)) {
      constructors.push(...module.default.agents);
    } else {
      constructors.push(module.default);
    }
    return constructors;
  } catch (e: any) {
    log.error("Error getting constructors", e.message);
    return [];
  }
};

const scanForAgents = async (path: string): Promise<Record<string, any>> => {
  const module = await import(path);
  const constructors = constructorsFromModule(module);
  const agents: Record<string, any> = {};
  for (const constructor of constructors) {
    const toolInterface = getToolInterface(constructor);
    if (toolInterface) {
      agents[constructor.name] = {
        description: toolInterface.description,
        input: zodToJsonSchema(toolInterface.args),
        output: zodToJsonSchema(toolInterface.returns),
        state: {},
      };
    } else {
      agents[constructor.name] = {
        description: "",
        input: {},
        output: {},
        state: {},
      };
    }
  }
  return agents;
};

interface DeployOptions {
  verbose: boolean;
  force: boolean;
  packageManager: string;
}

interface DeployResponse {
  success: boolean;
  deployment?: any;
  error?: string;
}

program
  .command("deploy")
  .option("-v, --verbose", "Show extra debug information")
  .option(
    "-f, --force",
    "Force deployment despite missing or local-only dependencies; will likely not work"
  )
  .option(
    "-p, --package-manager <packageManager>",
    "Package manager to use to lock dependencies [pnpm|npm|none]; pnpm is prefered for fastest spawn times; by default it will try to use best available"
  )
  .description("Deploy a project to sagentic.ai")
  .action(async (_options: DeployOptions) => {
    const progress = new SingleBar({});
    let response: AxiosResponse<DeployResponse>;
    try {
      const path = process.cwd();
      const distPath = Path.join(path, "dist");
      if (!FS.existsSync(distPath)) {
        log.error(
          `No ${chalk.cyan("dist")} folder found in ${chalk.blue(
            path
          )}. Please build your project first.`
        );
        return;
      }

      if (!(await checkAPIKey())) {
        log.error(chalk.red("Error: No valid Sagentic API key found\n"));
        log.error(
          `Please set your Sagentic API key in ${chalk.cyan(
            "SAGENTIC_API_KEY"
          )}.`
        );
        program.error(
          `Aborting due to an error: No valid Sagentic API key found`,
          { exitCode: 1 }
        );
      }

      // parse the package.json file
      const packageJsonPath = Path.join(path, "package.json");
      const packageJson = JSON.parse(FS.readFileSync(packageJsonPath, "utf-8"));
      //packageJson.dependencies.sagentic = "../../dist";
      // write the package.json file to dist
      const distPackageJsonPath = Path.join(distPath, "package.json");
      FS.writeFileSync(
        distPackageJsonPath,
        JSON.stringify(packageJson, null, 2)
      );

      // check for local dependencies
      const localDeps = getLocalDeps(packageJson, _options.verbose);
      if (localDeps.length > 0) {
        log.error(
          "The following local dependencies are not allowed in the deployment:\n",
          localDeps.join("\n")
        );
        if (!_options.force) {
          program.error(
            `Aborting due to an error: Local dependencies are not allowed in the deployment`,
            { exitCode: 1 }
          );
        }
      }

      // check for undeclared dependencies
      const undeclaredDeps = await checkDeps(distPath, _options.verbose);
      if (undeclaredDeps.length > 0) {
        log.error(
          "The following dependencies are used in your project but not declared in the package.json file:\n",
          undeclaredDeps.join("\n")
        );
        if (!_options.force) {
          program.error(
            `Aborting due to an error: Undeclared dependencies are not allowed in the deployment`,
            { exitCode: 1 }
          );
        }
      }

      // lock the dependencies
      const lockfile = await lockDeps(
        distPath,
        _options.packageManager,
        _options.verbose
      );

      console.log("Deploying project");
      // zip the dist folder into unique zip file in tmp
      const [zipPath, cleanup] = await tarProject(path);
      // upload to sagentic.ai with axios
      const url = `${SAGENTIC_API_URL}/deploy`;
      const formData = new FormData();
      const headers = formData.getHeaders();

      headers.Authorization = `Bearer ${SAGENTIC_API_KEY}`;

      const agents = await scanForAgents(distPath);

      formData.append(
        "manifest",
        JSON.stringify({
          name: packageJson.name,
          version: packageJson.version,
          description: packageJson.description,
          agents,
        })
      );

      // add file after all the other fields
      formData.append("file", FS.createReadStream(zipPath));

      progress.start(100, 0);
      response = await axios.post<DeployResponse>(url, formData, {
        headers,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            progress.update((100 * progressEvent.loaded) / progressEvent.total);
            if (progressEvent.loaded >= progressEvent.total) {
              progress.stop();
              console.log("Verifying deployment...");
            }
          }
        },
      });

      progress.stop();

      if (response.data.success) {
        console.log(
          `\nDeployment successful\nProject: ${chalk.green(
            response.data.deployment.project
          )}\nVersion: ${chalk.green(response.data.deployment.version)}\n`
        );

        const agents: any[] = response.data.deployment.agents;
        const agentRows: any[] = [];
        const cols = [" name", "version", "namespace"];
        Object.values(agents).forEach((agent) => {
          agentRows.push([agent.name, agent.version, agent.ns]);
        });
        console.log(chalk.green("Agents:"));
        console.log(cliTable(cols, agentRows));
        console.log(
          `\n Dashboard: ${chalk.blue(
            `https://app.sagentic.ai/project/${
              response.data.deployment.project?.split("/")[1]
            }`
          )}\n`
        );
      }
      cleanup();
    } catch (e: any) {
      progress.stop();
      response = e.response!;
      if (axios.isAxiosError(e)) {
        log.error(chalk.red(`Error: ${response.data.error}`));
        program.error(`Aborting due to an error`, { exitCode: 1 });
      } else {
        program.error(`Aborting due to an error: ${e.message}`, {
          exitCode: 1,
        });
      }
    }
  });

interface SpawnOptions {
  name: string;
  local: boolean;
  details: boolean;
  verbose: boolean;
  url?: string;
  timeout?: number;
}

interface SpawnResponse {
  success: boolean;
  result?: string;
  session?: SessionReport;
  error?: string;
  trace?: string;
}

program
  .command("spawn")
  .description("Spawn an agent")
  .option("-l, --local", "Spawn the agent locally")
  .option("-u, --url <url>", "URL of the sagentic server")
  .option("-d, --details", "Show extra details about the session")
  .option("-v, --verbose", "Show extra debug information")
  .option(
    "-t, --timeout <timeout>",
    "Abort the session if the agent is not reporting activity for a certain amount of time (in seconds); default is 1 minute"
  )
  .argument("<name>", "Name of the agent to spawn")
  .argument("[options...]", "Options for the agent, as key=value pairs")
  .action(async (name: string, options: string[], _options: SpawnOptions) => {
    try {
      let url: string;
      if (_options.local) {
        const port = process.env.PORT || 3000;
        url = `http://localhost:${port}`;
      } else if (_options.url) {
        url = _options.url;
      } else {
        url = SAGENTIC_API_URL;
      }

      if (!_options.local && !(await checkAPIKey())) {
        log.error(chalk.red("Error: No valid Sagentic API key found\n"));
        log.error(
          `Please set your Sagentic API key in ${chalk.cyan(
            "SAGENTIC_API_KEY"
          )}.`
        );
        program.error(
          `Aborting due to an error: No valid Sagentic API key found`,
          { exitCode: 1 }
        );
      }

      const agentOptions: Record<string, string> = {};
      for (const option of options) {
        const [key, value] = option.split("=");
        agentOptions[key] = value;
      }

      const headers: any = {
        "Content-Type": "application/json",
      };
      if (!_options.local) {
        headers.Authorization = `Bearer ${SAGENTIC_API_KEY}`;
      }

      let response: AxiosResponse<SpawnResponse>;
      try {
        response = await axios.post<SpawnResponse>(
          `${url}/spawn`,
          {
            type: name,
            options: agentOptions,
            timeout: (_options.timeout || 60) * 1000,
          },
          {
            headers,
          }
        );
      } catch (e: any) {
        response = e.response!;
        if (axios.isAxiosError(e)) {
          if (_options.verbose && response.data.trace) {
            log.error(chalk.red(`Stack trace: \n${response.data.trace}`));
          } else {
            log.error(chalk.red(`Error: ${response.data.error}`));
          }
          program.error(`Aborting due to an error`, { exitCode: 1 });
        } else {
          throw e;
        }
      }

      console.log(
        chalk.green(
          `Agent spawned successfully, response: \n\t${response.data.result}\n`
        )
      );
      if (_options.details) {
        if (!response.data.session) {
          console.log(chalk.yellow("No session details available"));
        } else {
          console.log("Session details:");
          console.log(
            `\tCost: $${response.data.session.totalCost.toFixed(2)}`,
            chalk.gray(`(${response.data.session.totalCost})`)
          );
          console.log(`\tTokens used: ${response.data.session.totalTokens}`);
          console.log(
            `\tElapsed time: ${moment
              .duration(response.data.session.elapsed)
              .humanize()}`,
            chalk.gray(`(${response.data.session.elapsed}s)`)
          );
          console.log("\tCost per model:");
          for (const model in response.data.session.cost) {
            console.log(
              `\t\t${model}: $${response.data.session.cost[
                model as ModelID
              ].toFixed(2)}`,
              chalk.gray(`(${response.data.session.cost[model as ModelID]})`)
            );
          }
          console.log("\tTokens per model:");
          for (const model in response.data.session.tokens) {
            console.log(
              `\t\t${model}: ${response.data.session.tokens[model as ModelID]}`
            );
          }
        }
      }
    } catch (e: any) {
      log.error(e);
      program.error(`Aborting due to an error: ${e.message}`, { exitCode: 1 });
    }
  });

program.parse(process.argv);
