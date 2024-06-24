// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

/** Available default providers */
export enum BuiltinProvider {
  OpenAI = "openai",
  AzureOpenAI = "azure-openai",
  Google = "google",
  Anthropic = "anthropic",
}
/** Deprecated identifier for builtin providers */
export import Provider = BuiltinProvider;

/** Provider identifier */
export type ProviderID = BuiltinProvider | string;

/** Available client types */
export enum ClientType {
	OpenAI = "openai",
	Google = "google",
	Anthropic = "anthropic",
}

/** default endpoints for each provider */
export const endpoints: Record<BuiltinProvider, string> = {
	[BuiltinProvider.OpenAI]: "https://api.openai.com/v1",
	[BuiltinProvider.Google]: "https://generativelanguage.googleapis.com",
	[BuiltinProvider.Anthropic]: "https://api.anthropic.com",
};

/** Describes provider API */
export interface ProviderMetadata {
	id: ProviderID; /** provider ID */
	url: string; /** URL of the API endpoint */
	clientType: ClientType; /** type of client to use */
}

export const providers: Record<ProviderID, ProviderMetadata> = {
	[BuiltinProvider.OpenAI]: {
		id: BuiltinProvider.OpenAI,
		url: endpoints[BuiltinProvider.OpenAI],
		clientType: ClientType.OpenAI,
	},
	[BuiltinProvider.Google]: {
		id: BuiltinProvider.Google,
		url: endpoints[BuiltinProvider.Google],
		clientType: ClientType.Google,
	},
	[BuiltinProvider.Anthropic]: {
		id: BuiltinProvider.Anthropic,
		url: endpoints[BuiltinProvider.Anthropic],
		clientType: ClientType.Anthropic,
	},
};

/** Model ID - used to identify models */
export type ModelID = BuiltinModel | string;

/** Available default model types */
export enum BuiltinModel {
  GPT4 = "gpt-4",
  GPT4Turbo = "gpt-4-turbo",
  GPT4Vision = "gpt-4-vision",
  GPT4o = "gpt-4o",
  GPT35Turbo = "gpt-3.5-turbo",

  GEMINI15 = "gemini-1.5-pro",
  GEMINI10 = "gemini-1.0-pro",
  GEMINI10Vision = "gemini-1.0-pro-vision",

  CLAUDE3Opus = "claude-3-opus",
  CLAUDE3Sonnet = "claude-3-sonnet",
  CLAUDE3Haiku = "claude-3-haiku",
}
/** Deprecated identifier for builtin models */
export import ModelType = BuiltinModel;

/** default model checkpoints for each model */
enum Checkpoint {
  GPT4 = "gpt-4",
  GPT4Turbo = "gpt-4-turbo-preview",
  GPT4Vision = "gpt-4-vision-preview",

  GPT4o = "gpt-4o",
  GPT4o240513 = "gpt-4o-2024-05-13",
  GPT4o240806 = "gpt-4o-2024-08-06",
  GPT4oMini = "gpt-4o-mini",
  GPT4oMini240718 = "gpt-4o-mini-2024-07-18",

  GPT35Turbo = "gpt-3.5-turbo-0125",

  O1 = "o1",
  O1mini = "o1-mini",

  GEMINI15 = "gemini-1.5-pro-latest",
  GEMINI10 = "gemini-1.0-pro",
  GEMINI10Vision = "gemini-1.0-pro-vision",

  CLAUDE3Opus = "claude-3-opus-20240229",
  CLAUDE3Sonnet = "claude-3-sonnet-20240229",
  CLAUDE3Haiku = "claude-3-haiku-20240307",

  AZURE_GPT4o = "azure/gpt-4o",
  AZURE_GPT4oMini = "azure/gpt-4o-mini",
}

/** Describes model checkpoint, context sizes, pricing and limits, etc. */
export interface ModelCard {
	/** name of the model checkpoint to use */
	checkpoint: string;
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
	id: ModelID; /** model type */
  provider: ProviderMetadata; /** provider API endpoint and client type */
  card: ModelCard; /** details about model, pricing, limits, etc. */
}

/** Default model cards for each model */
export const cards: Record<BuiltinModel, ModelCard> = {
  [BuiltinModel.GPT4]: {
		checkpoint: Checkpoint.GPT4,
    prompt: 30,
    completion: 60,
    contextSize: 8_192,
    rpm: 10_000,
    tpm: 300_000,
  },
  [BuiltinModel.GPT4Turbo]: {
		checkpoint: Checkpoint.GPT4Turbo,
    prompt: 10,
    completion: 30,
    contextSize: 128_000,
    rpm: 5000,
    tpm: 300_000,
  },
  [BuiltinModel.GPT4Vision]: {
		checkpoint: Checkpoint.GPT4Vision,
    prompt: 10,
    completion: 30,
    contextSize: 128_000,
    rpm: 80,
    tpm: 10_000,
    supportsImages: true,
  },
  [BuiltinModel.GPT4o]: {
		checkpoint: Checkpoint.GPT4o,
    prompt: 5,
    completion: 15,
    contextSize: 128_000,
    rpm: 500,
    tpm: 30_000,
    supportsImages: true,
    supportsVideo: true,
    supportsAudio: false, //NB audio support is not yet in the API, TODO add this once OpenAI adds it
  },
  [BuiltinModel.GPT4o240513]: {
    prompt: 5,
    completion: 15,
    contextSize: 128_000,
    rpm: 500,
    tpm: 30_000,
    supportsImages: true,
    supportsVideo: true,
    supportsAudio: false, //NB audio support is not yet in the API, TODO add this once OpenAI adds it
  },
  [BuiltinModel.GPT4o240806]: {
    prompt: 5,
    completion: 15,
    contextSize: 128_000,
    rpm: 500,
    tpm: 30_000,
    supportsImages: true,
    supportsVideo: true,
    supportsAudio: false, //NB audio support is not yet in the API, TODO add this once OpenAI adds it
  },
  [BultinModel.GPT4oMini]: {
    prompt: 0.15,
    completion: 0.6,
    contextSize: 128_000,
    rpm: 500,
    tpm: 30_000,
    supportsImages: true,
    supportsVideo: true,
    supportsAudio: false, //NB audio support is not yet in the API, TODO add this once OpenAI adds it
  },
  [BuiltinModel.GPT4oMini240718]: {
    prompt: 0.15,
    completion: 0.6,
    contextSize: 128_000,
    rpm: 500,
    tpm: 30_000,
    supportsImages: true,
    supportsVideo: true,
    supportsAudio: false, //NB audio support is not yet in the API, TODO add this once OpenAI adds it
  },
  [BuiltinModel.GPT35Turbo]: {
    prompt: 0.5,
    completion: 1.5,
    contextSize: 16_385,
    rpm: 10_000,
    tpm: 1_000_000,
  },
  [ModelType.O1]: {
    prompt: 15,
    completion: 60,
    contextSize: 200_000,
    rpm: 20,
    tpm: 30_000_000,
    supportsImages: false,
    supportsVideo: false,
    supportsAudio: false,
  },
  [ModelType.O1mini]: {
    prompt: 3,
    completion: 12,
    contextSize: 128_000,
    rpm: 20,
    tpm: 150_000_000,
    supportsImages: false,
    supportsVideo: false,
    supportsAudio: false,
  },
  //TODO ensure correct pricing for Gemini models
  [BuiltinModel.GEMINI15]: {
		checkpoint: Checkpoint.GEMINI15,
    prompt: 0.000007,
    completion: 0.000021,
    contextSize: 1_048_576 + 8192, //double check (should it include output?)
    rpm: 2,
    tpm: 32_000,
    supportsImages: true,
  },
  [BuiltinModel.GEMINI10]: {
		checkpoint: Checkpoint.GEMINI10,
    prompt: 0.0000005,
    completion: 0.0000015,
    contextSize: 30_720 + 2_048, //double check	(should it include output?)
    rpm: 360,
    tpm: 120_000,
  },
  [BuiltinModel.GEMINI10Vision]: {
    //TODO couldn't find anything quickly, copied from GEMINI10
		checkpoint: Checkpoint.GEMINI10Vision,
    prompt: 0.0000005,
    completion: 0.0000015,
    contextSize: 30_720 + 2_048, //double check (should it include output?)
    rpm: 360,
    tpm: 120_000,
    supportsImages: true,
  },
  [BuiltinModel.CLAUDE3Opus]: {
		checkpoint: Checkpoint.CLAUDE3Opus,
    prompt: 15,
    completion: 75,
    contextSize: 200_000,
    rpm: 5,
    tpm: 10_000,
    supportsImages: true,
  },
  [BuiltinModel.CLAUDE3Sonnet]: {
		checkpoint: Checkpoint.CLAUDE3Sonnet,
    prompt: 3,
    completion: 15,
    contextSize: 200_000,
    rpm: 5,
    tpm: 20_000,
    supportsImages: true,
  },
  [BuiltinModel.CLAUDE3Haiku]: {
		checkpoint: Checkpoint.CLAUDE3Haiku,
    prompt: 0.25,
    completion: 1.25,
    contextSize: 200_000,
    rpm: 5,
    tpm: 25_000,
    supportsImages: true,
  },
  [ModelType.AZURE_GPT4o]: {
    prompt: 2.5,
    completion: 10,
    contextSize: 128_000,
    rpm: 500,
    tpm: 30_000,
    supportsImages: true,
    supportsVideo: true,
    supportsAudio: false, //NB audio support is not yet in the API, TODO add this once OpenAI adds it
  },
  [ModelType.AZURE_GPT4oMini]: {
    prompt: 0.15,
    completion: 0.6,
    contextSize: 128_000,
    rpm: 500,
    tpm: 30_000,
    supportsImages: true,
    supportsVideo: true,
    supportsAudio: false, //NB audio support is not yet in the API, TODO add this once OpenAI adds it
  },
};

/** Model metadata */
export const models: Record<BuiltinModel, ModelMetadata> = {
  [BuiltinModel.GPT4]: {
		id: BuiltinModel.GPT4,
    provider: providers[BuiltinProvider.OpenAI],
    card: cards[BuiltinModel.GPT4],
  },
  [BuiltinModel.GPT4o]: {
		id: BuiltinModel.GPT4o,
    provider: providers[BuiltinProvider.OpenAI],
    card: cards[BuiltinModel.GPT4o],
  },
  [BuiltinModel.GPT4Turbo]: {
		id: BuiltinModel.GPT4Turbo,
    provider: providers[BuiltinProvider.OpenAI],
    card: cards[BuiltinModel.GPT4Turbo],
  [BuiltinModel.GPT4o240513]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT4o240513],
  },
  [BuiltinModel.GPT4o240806]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT4o240806],
  },
  [BuiltinModel.GPT4oMini]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT4oMini],
  },
  [BuiltinModel.GPT4oMini240718]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.GPT4oMini240718],
  },
  },
  [BuiltinModel.GPT4Vision]: {
		id: BuiltinModel.GPT4Vision,
    provider: providers[BuiltinProvider.OpenAI],
    card: cards[BuiltinModel.GPT4Vision],
  },
  [BuiltinModel.GPT35Turbo]: {
		id: BuiltinModel.GPT35Turbo,
    provider: providers[BuiltinProvider.OpenAI],
    card: cards[BuiltinModel.GPT35Turbo],
  },
  [ModelType.O1]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.O1],
  },
  [ModelType.O1mini]: {
    provider: Provider.OpenAI,
    pricing: pricing[ModelType.O1mini],
  },
  [ModelType.GEMINI15]: {
    provider: Provider.Google,
    pricing: pricing[ModelType.GEMINI15],
  },
  [BuiltinModel.GEMINI10]: {
		id: BuiltinModel.GEMINI10,
    provider: providers[BuiltinProvider.Google],
    card: cards[BuiltinModel.GEMINI10],
  },
  [BuiltinModel.GEMINI10Vision]: {
		id: BuiltinModel.GEMINI10Vision,
    provider: providers[BuiltinProvider.Google],
    card: cards[BuiltinModel.GEMINI10Vision],
  },
  [BuiltinModel.CLAUDE3Opus]: {
		id: BuiltinModel.CLAUDE3Opus,
    provider: providers[BuiltinProvider.Anthropic],
    card: cards[BuiltinModel.CLAUDE3Opus],
  },
  [BuiltinModel.CLAUDE3Sonnet]: {
		id: BuiltinModel.CLAUDE3Sonnet,
    provider: providers[BuiltinProvider.Anthropic],
    card: cards[BuiltinModel.CLAUDE3Sonnet],
  },
  [BuiltinModel.CLAUDE3Haiku]: {
		id: BuiltinModel.CLAUDE3Haiku,
    provider: providers[BuiltinProvider.Anthropic],
    card: cards[BuiltinModel.CLAUDE3Haiku],
  },
  [ModelType.AZURE_GPT4o]: {
    provider: Provider.AzureOpenAI,
    pricing: pricing[ModelType.AZURE_GPT4o],
  },
  [ModelType.AZURE_GPT4oMini]: {
    provider: Provider.AzureOpenAI,
    pricing: pricing[ModelType.AZURE_GPT4oMini],
  },
};

/** Resolves model metadata
 * Agents store models as either a reference to a builtin model or a custom model metadata object.
 * This function resolves the model metadata from either of these representations.
 * @param model - model reference or metadata object
 * @returns model metadata object
 * */
export const resolveModelMetadata = function (model: BuiltinModel | ModelMetadata): ModelMetadata {
	if (typeof model === "string") {
		return models[model as BuiltinModel];
	}
	return model;
}

