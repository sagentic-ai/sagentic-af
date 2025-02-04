import { Project, SourceFile } from "ts-morph";
import { makeZod } from "./zodGen";

const SCHEMA_FILE = "schemas.gen.ts";

type SchemaMap = Record<string, Record<string, any>>;
const globalParamSchemas: SchemaMap = {};
const globalReturnSchemas: SchemaMap = {};

function generateSchema(sourceFile: SourceFile): [SchemaMap, SchemaMap] {
  const paramSchemas: SchemaMap = {};
  const returnSchemas: SchemaMap = {};

  sourceFile.getClasses().forEach((classDecl) => {
    const className = classDecl.getName()!;

    classDecl.getMethods().forEach((method) => {
      const hasToolDecorator = method
        .getDecorators()
        .some((d) => d.getName() === "tool");
      const hasWhenDecorator = method
        .getDecorators()
        .some((d) => d.getName() === "when");

      if (hasToolDecorator || hasWhenDecorator) {
        const methodName = method.getName();
        const parameters = method.getParameters();
        const returns = method.getReturnType();

        if (!paramSchemas[className]) {
          paramSchemas[className] = {};
        }
        if (!returnSchemas[className]) {
          returnSchemas[className] = {};
        }

        if (hasToolDecorator) {
          if (parameters.length > 0) {
            const t = parameters[0].getType();
            paramSchemas[className][methodName] = makeZod(t);
          } else {
            paramSchemas[className][methodName] = "z.object({})";
          }
          returnSchemas[className][methodName] = makeZod(returns);
        }

        if (hasWhenDecorator) {
          if (parameters.length > 1) {
            const t = parameters[1].getType();
            paramSchemas[className][methodName] = makeZod(t);
          } else {
            paramSchemas[className][methodName] = "z.object({})";
          }
        }
      }
    });
  });

  return [paramSchemas, returnSchemas];
}

function updateGlobalSchemas(
  newParamSchemas: SchemaMap,
  newReturnSchemas: SchemaMap,
  sourceFilePath: string
) {
  // Remove existing schemas for this file
  Object.keys(globalParamSchemas).forEach((className) => {
    if (globalParamSchemas[className].__sourceFile === sourceFilePath) {
      delete globalParamSchemas[className];
    }
  });
  Object.keys(globalReturnSchemas).forEach((className) => {
    if (globalReturnSchemas[className].__sourceFile === sourceFilePath) {
      delete globalReturnSchemas[className];
    }
  });

  // Add new schemas with source file tracking
  Object.entries(newParamSchemas).forEach(([className, methods]) => {
    globalParamSchemas[className] = {
      ...methods,
      __sourceFile: sourceFilePath,
    };
  });
  Object.entries(newReturnSchemas).forEach(([className, methods]) => {
    globalReturnSchemas[className] = {
      ...methods,
      __sourceFile: sourceFilePath,
    };
  });
}

function writeSchemaFile(project: Project) {
  let schema = "import {z} from 'zod';\n\n";
  schema += `// WARNING: This file is auto-generated - don't edit by hand!\n\n`;
  schema += `declare global {
    var __PARAM_SCHEMAS__: Record<string, Record<string, z.ZodType>>;
    var __RETURN_SCHEMAS__: Record<string, Record<string, z.ZodType>>;
}\n\n`;

  schema += "globalThis.__PARAM_SCHEMAS__ = {\n";
  for (const className in globalParamSchemas) {
    const methods = { ...globalParamSchemas[className] };
    delete methods.__sourceFile; // Remove metadata before writing

    schema += `'${className}': {`;
    Object.entries(methods).forEach(([methodName, zodSchema]) => {
      schema += `'${methodName}': ${zodSchema},\n`;
    });
    schema += "},\n";
  }
  schema += "};\n\n";

  schema += "globalThis.__RETURN_SCHEMAS__ = {\n";
  for (const className in globalReturnSchemas) {
    const methods = { ...globalReturnSchemas[className] };
    delete methods.__sourceFile; // Remove metadata before writing

    schema += `'${className}': {`;
    Object.entries(methods).forEach(([methodName, zodSchema]) => {
      schema += `'${methodName}': ${zodSchema},\n`;
    });
    schema += "},\n";
  }
  schema += "};";

  const outputFile = project.createSourceFile("./" + SCHEMA_FILE, schema, {
    overwrite: true,
  });

  outputFile.formatText();
  outputFile.saveSync();
}

export async function generateSchemas() {
  const project = new Project({
    tsConfigFilePath: "tsconfig.json",
  });

  for (const sourceFile of project.getSourceFiles()) {
    const [paramSchemas, returnSchemas] = generateSchema(sourceFile);
    updateGlobalSchemas(paramSchemas, returnSchemas, sourceFile.getFilePath());
  }
  writeSchemaFile(project);
}
