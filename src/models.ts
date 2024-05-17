// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

/** Available providers */
export enum Provider {
  OpenAI = "openai",
  Google = "google",
}

/** Available model types */
export enum ModelType {
  GPT4 = "gpt-4",
  GPT4Turbo = "gpt-4-turbo-preview",
  GPT4Vision = "gpt-4-vision-preview",
  GPT4o = "gpt-4o",

  GPT35Turbo = "gpt-3.5-turbo-0125",

  GEMINI15 = "gemini-1.5-pro-latest",
  GEMINI10 = "gemini-1.0-pro",
  GEMINI10Vision = "gemini-1.0-pro-vision",
}

/** Describes model pricing and limits */
export interface ModelPricing {
  /** price per 1M prompt tokens in USD */
  prompt: number;
  /** price per 1M completion tokens in USD */
  completion: number;
  /** context size in tokens */
  contextSize: number;
  /** requests per minute */
  rpm: number;
  /** tokens per minute */
  tpm: number;
  /** does it support images? */
  supportsImages?: boolean;
  /** does it support video? */
  supportsVideo?: boolean;
  /** does it support audio? */
  supportsAudio?: boolean;
}

/** Describes model metadata */
export interface ModelMetadata {
  provider: Provider;
  pricing: ModelPricing;
}

/** Pricing and limits for each model */
export const pricing: Record<ModelType, ModelPricing> = {
  [ModelType.GPT4]: {
    prompt: 30,
    completion: 60,
    contextSize: 8_192,
    rpm: 10_000,
    tpm: 300_000,
  },
  [ModelType.GPT4Turbo]: {
    prompt: 10,
    completion: 30,
    contextSize: 128_000,
    rpm: 5000,
    tpm: 300_000,
  },
  [ModelType.GPT4Vision]: {
    prompt: 10,
    completion: 30,
    contextSize: 128_000,
    rpm: 80,
    tpm: 10_000,
    supportsImages: true,
  },
  [ModelType.GPT4o]: {
    prompt: 5,
    completion: 15,
    contextSize: 128_000,
    rpm: 500,
    tpm: 30_000,
    supportsImages: true,
    supportsVideo: true,
    supportsAudio: false, //NB audio support is not yet in the API, TODO add this once OpenAI adds it
  },
  [ModelType.GPT35Turbo]: {
    prompt: 0.5,
    completion: 1.5,
    contextSize: 16_385,
    rpm: 10_000,
    tpm: 1_000_000,
  },
  //TODO ensure correct pricing for Gemini models
  [ModelType.GEMINI15]: {
    prompt: 0.000007,
    completion: 0.000021,
    contextSize: 1_048_576 + 8192, //double check (should it include output?)
    rpm: 5,
    tpm: 10_000_000,
    supportsImages: true,
  },
  [ModelType.GEMINI10]: {
    prompt: 0.0000005,
    completion: 0.0000015,
    contextSize: 30_720 + 2_048, //double check	(should it include output?)
    rpm: 360,
    tpm: 120_000,
  },
  [ModelType.GEMINI10Vision]: {
    //TODO couldn't find anything quickly, copied from GEMINI10
    prompt: 0.0000005,
    completion: 0.0000015,
    contextSize: 30_720 + 2_048, //double check (should it include output?)
    rpm: 360,
    tpm: 120_000,
    supportsImages: true,
  },
};

/** Model metadata */
export const models: Record<ModelType, ModelMetadata> = {
  [ModelType.GPT4]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT4],
  },
  [ModelType.GPT4o]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT4o],
  },
  [ModelType.GPT4Turbo]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT4Turbo],
  },
  [ModelType.GPT4Vision]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT4Vision],
  },
  [ModelType.GPT35Turbo]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT35Turbo],
  },
  [ModelType.GEMINI15]: {
    provider: Provider.Google,
    pricing: pricing[ModelType.GEMINI15],
  },
  [ModelType.GEMINI10]: {
    provider: Provider.Google,
    pricing: pricing[ModelType.GEMINI10],
  },
  [ModelType.GEMINI10Vision]: {
    provider: Provider.Google,
    pricing: pricing[ModelType.GEMINI10Vision],
  },
};

/** List of available models */
export const availableModels: ModelType[] = Object.keys(models) as ModelType[];
