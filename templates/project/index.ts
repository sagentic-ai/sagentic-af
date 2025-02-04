import { ModelID, ModelMetadata, ProviderID, ClientOptions } from "@sagentic-ai/sagentic-af";
import "./schemas.gen";

import dotenv from "dotenv";
dotenv.config();

// Import your agent classes here
import HelloAgent from "./agents/hello";

// Export an array of them here
export default [
  HelloAgent, //
];

// If you are using custom provider endpoints and need to provider API keys to them, define them here
// and provide them as env variables in the .env file, e.g.:
// "myProviderID": process.env.MY_PROVIDER_API_KEY
export const ProviderApiKeys: Partial<Record<ProviderID, string>> = {
}

// If you are using custom model cards, export them here
export const Models: ModelMetadata[] = [
];

// If you need to provider custom model options for some of your agents, define them here
export const ModelOptions: Partial<Record<ModelID, ClientOptions>> = {
}
