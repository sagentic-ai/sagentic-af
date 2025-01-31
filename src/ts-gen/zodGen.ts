import { SyntaxKind } from "ts-morph";
import { Type, PropertySignature, ts, InterfaceDeclaration } from "ts-morph";

/*******
 * This code basically takes z ts-morph Type object and recursively turns it into TS source code that uses zod to define equivalent type.
 *
 * It takes some small shortcuts but overall works pretty well on anything that can be reasonably expressed in JSON.
 * It detects standard types like Record<K, T> etc.
 *
 * It reads JSDoc comments from the source code and uses them as descriptions for the zod types.
 *
 * TODO
 * - Handle TS enums properly
 * - Ignore function properties from object types
 * - Ignore Symbol properties from object types
 */

/**
 * This takes unions of types and turns them into zod unions or enums.
 * If all types are string literals, it will create a z.enum() call.
 * If the union contains undefined and null, it will create a z.nullish() call.
 * If the union contains undefined, it will create a z.optional() call.
 * If the union contains null, it will create a z.nullable() call.
 * Otherwise, it will create a z.union() call.
 *
 * @param t ts-morph Type object representing a union type
 * @param optional whether the type is optional (will be wrapped in .optional())
 * @returns TS source code that uses zod to define equivalent type
 */
function makeZodUnion(
  t: Type<ts.UnionType>,
  optional: boolean = false
): string {
  // if all types are string literals
  if (t.getUnionTypes().every((type) => type.isStringLiteral())) {
    let ret = "z.enum([";
    ret += t
      .getUnionTypes()
      .map((type) => `${type.getText()}`)
      .join(", ");
    ret += "])";
    if (optional) {
      ret += ".optional()";
    }
    return ret;
  }

  // X | undefined | null
  if (
    t.getUnionTypes().some((type) => type.isUndefined()) &&
    t.getUnionTypes().some((type) => type.isNull())
  ) {
    const definedTypes = t
      .getUnionTypes()
      .filter((type) => !type.isUndefined() && !type.isNull());
    if (definedTypes.length === 1) {
      return makeZod(definedTypes[0]) + ".nullish()";
    }
    return (
      makeZodUnion(t.getNonNullableType() as Type<ts.UnionType>) + ".nullish()"
    );
  }

  // X | undefined
  if (t.getUnionTypes().some((type) => type.isUndefined())) {
    const definedTypes = t
      .getUnionTypes()
      .filter((type) => !type.isUndefined());
    if (definedTypes.length === 1) {
      return makeZod(definedTypes[0], true);
    }
    return (
      makeZodUnion(t.getNonNullableType() as Type<ts.UnionType>) +
      (optional ? "" : ".optional()")
    );
  }

  // X | null
  if (t.getUnionTypes().some((type) => type.isNull())) {
    const definedTypes = t.getUnionTypes().filter((type) => !type.isNull());
    if (definedTypes.length === 1) {
      return (
        makeZod(definedTypes[0]) + (optional ? ".nullish()" : ".nullable()")
      );
    }
    return (
      makeZodUnion(t.getNonNullableType() as Type<ts.UnionType>) +
      (optional ? ".nullish()" : ".nullable()")
    );
  }

  // otherwise
  let ret = "z.union([";
  ret += t
    .getUnionTypes()
    .map((type) => makeZod(type))
    .join(", ");
  ret += "])";
  if (optional) {
    ret += ".optional()";
  }
  return ret;
}

/**
 * Recursively turns a ts-morph Type object into TS source code that uses zod to define equivalent type.
 *
 * @param t arbitrary ts-morph Type object
 * @param optional whether the type is optional (will be wrapped in .optional())
 * @param description human-readable description of the type, will be passed to .describe()
 * @returns TS source code that uses zod to define equivalent type
 */
export function makeZod(
  t: Type,
  optional: boolean = false,
  description: string = ""
): string {
  let ret = "";
  if (t.getText() === "Date") {
    ret = "z.date()";
  } else if (t.getText() === "BigInt") {
    ret = "z.bigint()";
  } else if (t.isBigInt()) {
    ret = "z.bigint()";
  } else if (t.getAliasSymbol()?.getName() === "Record") {
    ret = `z.record(z.string(), ${makeZod(t.getAliasTypeArguments()[1])})`;
  } else if (t.isArray()) {
    ret = "z.array(";
    const elementType = t.getArrayElementType();
    console.log("Array element type: ", elementType?.getText());
    if (!elementType) {
      ret += "z.any()";
    } else {
      ret += makeZod(elementType);
    }
    ret += ")";
  } else if (t.isTuple()) {
    ret = "z.tuple([";
    const elements = t.getTupleElements();
    ret += elements.map((type) => makeZod(type)).join(", ");
    ret += "])";
  } else if (t.isObject()) {
    let objectDesc: string | undefined = undefined;
    if (t.isInterface()) {
      const tSymbol = t.getSymbol();
      if (tSymbol) {
        const dec: InterfaceDeclaration = tSymbol
          .getDeclarations()[0]
          .asKind(SyntaxKind.InterfaceDeclaration) as InterfaceDeclaration;
        objectDesc = dec
          .getJsDocs()
          .map((d) => d.getDescription())
          .join(" ")
          .trim();
      }
    }
    ret += "z.object({";
    const properties = t.getProperties();
    const propSignatures = [];
    for (const prop of properties) {
      const declarations = prop.getDeclarations();
      const propType = prop.getTypeAtLocation(declarations[0]);

      let desc: string | undefined = (declarations[0] as PropertySignature)
        .getJsDocs()
        .map((d) => d.getDescription())
        .join(" ");
      if (desc === "") {
        desc = undefined;
      }
      propSignatures.push(
        `${prop.getName()}: ${makeZod(propType, prop.isOptional(), desc)}`
      );
    }
    ret += propSignatures.join(", ");
    ret += "})";
    if (objectDesc) {
      ret += `.describe(${JSON.stringify(objectDesc)})`;
    }
  } else if (t.isString()) {
    ret = "z.string()";
  } else if (t.isNumber()) {
    ret = "z.number()";
  } else if (t.isBoolean()) {
    ret = "z.boolean()";
  } else if (t.isUnion()) {
    ret = makeZodUnion(t, optional);
    if (description) {
      ret = `${ret}.describe(${JSON.stringify(description)})`;
    }
    return ret;
  } else if (t.isIntersection()) {
    ret = "z.intersection(";
    const types = t.getIntersectionTypes();
    ret += types.map((type) => makeZod(type)).join(", ");
    ret += ")";
  } else if (t.isClass()) {
    console.log("Class type");
    ret = "z.object({/* class */})";
  } else if (t.isStringLiteral()) {
    ret = `z.literal(${t.getText()})`;
  } else {
    if (t.isLiteral()) {
      ret = `z.literal(${t.getText()})`;
    } else {
      console.log("Unknown type: ", t.getText());
      ret = "z.any(/* unknown */)";
    }
  }
  if (optional) {
    ret = `${ret}.optional()`;
  }
  if (description) {
    ret = `${ret}.describe(${JSON.stringify(description)})`;
  }
  return ret;
}
