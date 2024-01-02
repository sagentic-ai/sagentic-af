#!/usr/bin/env node

import Path from "path";
import FS from "fs";
import { Command } from "commander";
import { version } from "../package.json";
import prompts from "prompts";
import chalk from "chalk";
import { startServer } from "../src/server/server";
import dotenv from "dotenv";
dotenv.config();

const PACKAGE_PATH = Path.resolve(__dirname, "..");

// TODO: set this to NPM package name when published
const PACKAGE_NAME = PACKAGE_PATH;

const banner = () => {
  console.log(`\n😎 ${chalk.yellow(`Bazed.ai Agent Framework`)} ${chalk.gray("v" + version)}\n`);
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
      : `${i++}. Change directory to your project folder:
  ${chalk.cyan(cdCommand)}\n`;

  console.log(`🙌 ${chalk.yellow("You're all set!")}\n
Next steps:\n
${relativeStep}
${i++}. Set your OpenAI API key in the ${chalk.cyan(".env")} file.\n
${i++}. Install dependencies and run the development server:
  ${chalk.cyan(installCommand)}\n
${i++}. Start the development server:
  ${chalk.cyan(runCommand)}\n`);
};

const copyTemplate = (
  templateName: string,
  targetPath: string,
  variables: Record<string, string>
) => {
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
};

const program = new Command();

program
  .name("bazed")
  .version(version)
  .description("😎 Bazed Agent Framework CLI");

interface InitOptions {
  name?: string;
}

program
  .command("init")
  .argument("[path]", "Path to the project", ".")
  .option("-n, --name <name>", "Name of the project")
  .description("Initialize a new project")
  .action(async (path: string, options: InitOptions) => {
    banner();
    const fullPath = Path.resolve(process.cwd(), path);
    const basename = Path.basename(fullPath);
    const targetPathExists = FS.existsSync(fullPath);

    // if the name is not specified use the basename of the path
    let name = options.name || basename;

    // if path doesn't exist, create it
    if (!targetPathExists) {
      console.log(`${chalk.blue(path)} doesn't exist.`);
      const { ok } = await prompts({
        type: "confirm",
        name: "ok",
        initial: true,
        message: `Create ${chalk.blue(path)}?`,
      });
      if (!ok) {
        console.log("Aborting");
        return;
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
      BAZED_PACKAGE: PACKAGE_NAME,
    };
    copyTemplate("project", fullPath, variables);

    console.log(
      "Initializing a new project at",
      path,
      process.cwd(),
      options.name,
      fullPath
    );
    outro("yarn", fullPath);
  });

const commandNew = program
  .command("new")
  .description("Scaffold agents and tools");

commandNew
  .command("agent")
  .argument("<name>", "Name of the new agent")
  .description("Scaffold a new agent")
  .action(() => {
    console.log("Creating new agent");
  });

commandNew
  .command("tool")
  .argument("<name>", "Name of the new tool")
  .description("Scaffold a new tool")
  .action(() => {
    console.log("Running a project");
  });

program
  .command("run")
  .description("Run a project")
  .arguments("[importPaths...]")
  .action(async (importPaths: string[], _options: object) => {
    if (importPaths.length === 0) {
      importPaths = ["."];
    }
    await startServer({
      port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      imports: importPaths,
    });
  });

program
  .command("deploy")
  .description("Deploy a project to Bazed.ai")
  .action(() => {
    console.log("Deploying project");
  });

program.parse(process.argv);
