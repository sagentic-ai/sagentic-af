import { Project, SourceFile } from "ts-morph";
import { makeZod } from "../src/ts-gen/zodGen";

/*****
 * This script watches for changes in TypeScript files and generates Zod schemas for methods decorated with `@inferMe`.
 * Run this with `deno run gen:watch` before running the example.
 */

const SCHEMA_FILE = "schemas.gen.ts";

type SchemaMap = Record<string, [Record<string, any>, Record<string, any>]>;
const globalSchemas: SchemaMap = {};

function generateSchema(sourceFile: SourceFile): SchemaMap {
  const schemas: SchemaMap = {};

  sourceFile.getClasses().forEach((classDecl) => {
    const className = classDecl.getName()!;

    classDecl.getMethods().forEach((method) => {
      const hasInferMeDecorator = method
        .getDecorators()
        .some((d) => d.getName() === "inferMe");

      if (hasInferMeDecorator) {
        const methodName = method.getName();
        const parameters = method.getParameters();
        const returns = method.getReturnType();

        if (!schemas[className]) {
          schemas[className] = [{}, {}];
        }

        if (parameters.length > 0) {
          const t = parameters[0].getType();
          console.log("Type: ", t.getText(), t.isArray());
          schemas[className][0][methodName] = makeZod(t);
        } else {
          schemas[className][0][methodName] = "z.object({})";
        }

        schemas[className][1][methodName] = makeZod(returns);
      }
    });
  });

  return schemas;
}

function updateGlobalSchemas(newSchemas: SchemaMap, sourceFilePath: string) {
  // Remove existing schemas for this file
  Object.keys(globalSchemas).forEach((className) => {
    if (globalSchemas[className][0].__sourceFile === sourceFilePath) {
      delete globalSchemas[className];
    }
  });

  // Add new schemas with source file tracking
  Object.entries(newSchemas).forEach(([className, [methods, returns]]) => {
    globalSchemas[className] = [
      {
        ...methods,
        __sourceFile: sourceFilePath,
      },
      {
        ...returns,
        __sourceFile: sourceFilePath,
      },
    ];
  });
}

function writeSchemaFile(project: Project) {
  let schema = "import {z} from 'zod';\n\n";
  schema += `// WARNING: This file is auto-generated - don't edit by hand!\n\n`;
  schema += `declare global {
    var __SCHEMAS__: Record<string, [Record<string, z.ZodType>, Record<string, z.ZodType>]>;
}\n\n`;

  schema += "globalThis.__SCHEMAS__ = {\n";
  for (const className in globalSchemas) {
    const methods = { ...globalSchemas[className][0] };
    const returns = { ...globalSchemas[className][1] };
    delete methods.__sourceFile; // Remove metadata before writing

    schema += `'${className}': [{`;
    Object.entries(methods).forEach(([methodName, zodSchema]) => {
      schema += `'${methodName}': ${zodSchema},\n`;
    });
    schema += `}, {`;
    Object.entries(returns).forEach(([methodName, zodSchema]) => {
      schema += `'${methodName}': ${zodSchema},\n`;
    });
    schema += "}],\n";
  }
  schema += "};";

  const outputFile = project.createSourceFile("./" + SCHEMA_FILE, schema, {
    overwrite: true,
  });

  outputFile.formatText();
  outputFile.saveSync();
}

async function main() {
  const project = new Project({
    tsConfigFilePath: "tsconfig.json",
  });

  // Initial run on all TypeScript files
  for (const sourceFile of project.getSourceFiles()) {
    const schemas = generateSchema(sourceFile);
    updateGlobalSchemas(schemas, sourceFile.getFilePath());
  }
  writeSchemaFile(project);

  // // Watch for changes
  // const watcher = Deno.watchFs(".");
  // for await (const event of watcher) {
  //   if (
  //     event.kind === "modify" &&
  //     event.paths[0].endsWith(".ts") &&
  //     !event.paths[0].endsWith(SCHEMA_FILE)
  //   ) {
  //     const filepath = event.paths[0];
  //     console.log(`File ${filepath} has been changed`);

  //     const sourceFile =
  //       project.getSourceFile(filepath) ||
  //       project.addSourceFileAtPath(filepath);

  //     const schemas = generateSchema(sourceFile);
  //     updateGlobalSchemas(schemas, filepath);
  //     writeSchemaFile(project);
  //   }
  // }
}

main();
