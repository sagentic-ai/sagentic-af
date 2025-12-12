// Copyright 2025 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { z } from "zod";

export type SchemaRegistry = Record<string, Record<string, z.ZodType>>;

const PARAM_SCHEMAS_KEY = Symbol.for("sagentic-af:__PARAM_SCHEMAS__");
const RETURN_SCHEMAS_KEY = Symbol.for("sagentic-af:__RETURN_SCHEMAS__");

function ensureRegistry(key: symbol, legacyKey: string): SchemaRegistry {
  const g = globalThis as unknown as Record<symbol, unknown>;

  const existing = g[key] as SchemaRegistry | undefined;
  if (existing) return existing;

  // Backwards compatibility: older code (and generated schemas) may populate
  // globalThis.__PARAM_SCHEMAS__ / globalThis.__RETURN_SCHEMAS__.
  const legacy = (globalThis as unknown as Record<string, unknown>)[
    legacyKey
  ] as SchemaRegistry | undefined;
  if (legacy) {
    g[key] = legacy;
    return legacy;
  }

  const created: SchemaRegistry = {};
  g[key] = created;
  // Also set the legacy key so older runtime integrations keep working.
  (globalThis as unknown as Record<string, unknown>)[legacyKey] = created;
  return created;
}

export function getParamSchemas(): SchemaRegistry {
  return ensureRegistry(PARAM_SCHEMAS_KEY, "__PARAM_SCHEMAS__");
}

export function getReturnSchemas(): SchemaRegistry {
  return ensureRegistry(RETURN_SCHEMAS_KEY, "__RETURN_SCHEMAS__");
}


