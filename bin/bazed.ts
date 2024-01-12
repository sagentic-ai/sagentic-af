#!/usr/bin/env node

import Path from "path";
import FS from "fs";
import { Command } from "commander";
import { version } from "../package.json";
import prompts from "prompts";
import chalk from "chalk";
import { startServer } from "../src/server/server";
import dotenv from "dotenv";
import child_process from "child_process";
import axios from "axios";
import FormData from "form-data";
import { SingleBar, Presets } from "cli-progress";
dotenv.config();

const PACKAGE_PATH = Path.resolve(__dirname, "..");

// TODO: set this to NPM package name when published
const PACKAGE_NAME = "@xiv-bazed-ai/bazed-af";

const banner = () => {
  console.log(
    `\n😎 ${chalk.yellow(`Bazed.ai Agent Framework`)} ${chalk.gray(
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

const copySrcTemplate = (
  templateName: string,
  targetPath: string,
  variables: Record<string, string>
) => {
  const templatePath = Path.join(PACKAGE_PATH, "templates", templateName);
  let content = FS.readFileSync(templatePath, "utf-8");
  for (const key in variables) {
    content = content.replace(new RegExp(`${key}`, "g"), variables[key]);
  }
  FS.writeFileSync(targetPath, content);
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
      console.log(`Directory ${chalk.blue(path)} doesn't exist.`);
      const { ok } = await prompts({
        type: "confirm",
        name: "ok",
        initial: true,
        message: `Create ${chalk.blue(path)} directory?`,
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
    outro("yarn", fullPath);
  });

const commandNew = program
  .command("new")
  .description("Scaffold agents and tools");

const addExport = (path: string, name: string, importPath: string) => {
  const content = FS.readFileSync(path, "utf-8");
  const lines = content.split("\n");
  const lastImport = lines.findIndex((line) => line.startsWith("import"));
  lines.splice(lastImport + 1, 0, `import ${name} from "./${importPath}";`);

  const exportIndex = lines.findIndex((line) => line.startsWith("export"));
  lines.splice(exportIndex + 1, 0, `  ${name},`);

  FS.writeFileSync(path, lines.join("\n"));
};

commandNew
  .command("agent")
  .argument("<name>", "Name of the new agent")
  .argument("[type]", "Type of the new agent", "reactive")
  .description("Scaffold a new agent")
  .action(async (name: string, type: string) => {
    const fullPath = Path.join(
      process.cwd(),
      "agents",
      toKebabCase(name) + ".ts"
    );
    copySrcTemplate(`agents/${type}.ts`, fullPath, {
      Example: toPascalCase(name),
    });
    addExport(
      Path.join(process.cwd(), "index.ts"),
      toPascalCase(name),
      `agents/${toKebabCase(name)}`
    );
  });

commandNew
  .command("tool")
  .argument("<name>", "Name of the new tool")
  .description("Scaffold a new tool")
  .action((name: string) => {
    const fullPath = Path.join(process.cwd(), "tools", toKebabCase(name));
    const type = "tool";
    copySrcTemplate(`tools/${type}.ts`, fullPath, {
      ExampleAgent: toCamelCase(name),
    });
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

program.command("platform").action(async (_options: object) => {
  await startServer({
    port: process.env.PORT ? parseInt(process.env.PORT) : 9000,
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    imports: [],
    platform: true,
  });
});

program
  .command("deploy")
  .description("Deploy a project to bazed.ai")
  .action(async () => {
    const progress = new SingleBar({});
    try {
      const path = process.cwd();
      const distPath = Path.join(path, "dist");
      if (!FS.existsSync(distPath)) {
        console.log(
          `No ${chalk.cyan("dist")} folder found in ${chalk.blue(
            path
          )}. Please build your project first.`
        );
        return;
      }

      // parse the package.json file
      const packageJsonPath = Path.join(path, "package.json");
      const packageJson = JSON.parse(FS.readFileSync(packageJsonPath, "utf-8"));
      packageJson.dependencies.bazed = "../../dist";
      // write the package.json file to dist
      const distPackageJsonPath = Path.join(distPath, "package.json");
      FS.writeFileSync(
        distPackageJsonPath,
        JSON.stringify(packageJson, null, 2)
      );

      console.log("Deploying project");
      // zip the dist folder
      const zipPath = Path.join(path, "dist.zip");
      // invoke zip command with dist folder
      const zipCommand = `zip -r ${zipPath} dist/*`;
      child_process.execSync(zipCommand);
      // upload to bazed.ai with axios
      const url = "http://p.bazed.ai/deploy";
      const formData = new FormData();
      formData.append("file", FS.createReadStream(zipPath));
      const headers = formData.getHeaders();

      progress.start(100, 0);
      const response = await axios.post(url, formData, {
        headers,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total)
            progress.update((100 * progressEvent.loaded) / progressEvent.total);
        },
      });
      progress.stop();
      // delete the zip file
      FS.unlinkSync(zipPath);
      // console.log(response.data);
      console.log("Project deployed successfully");
    } catch (e) {
      progress.stop();
      console.log(e);
    }
  });

program.parse(process.argv);
