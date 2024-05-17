// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import {
  GoogleGenerativeAI,
  GenerateContentRequest,
  GenerateContentResult,
  Content,
  TextPart,
} from "@google/generative-ai";
import { ModelType, pricing } from "../models";
import {
  Client,
  GoogleClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./common";
import { BaseClient, RejectionReason } from "./base";
import { Message, MessageRole, ContentPart, TextContentPart } from "../thread";

function parseContents(
  messages: Message[],
  makeSystemPrompt: boolean
): [Content[], Content?] {
  const contents: Content[] = [];
  const systemPrompt: Content = {
    role: "user",
    parts: [],
  };
  for (const message of messages) {
    const msgs = Array.isArray(message.content)
      ? message.content
      : [message.content];
    const parts = msgs
      .filter(
        (msg: string | ContentPart | null) =>
          typeof msg === "string" || (msg && msg.type === "text")
      )
      .map((msg: string | ContentPart | null) => {
        switch (typeof msg) {
          case "string":
            return {
              text: msg,
            } as TextPart;
          case "object":
            return {
              text: (msg! as TextContentPart).text,
            } as TextPart;
          default:
            return {
              text: "",
            } as TextPart;
        }
      });
    switch (message.role) {
      case MessageRole.System:
        systemPrompt.parts = parts;
        break;
      case MessageRole.User:
        contents.push({
          role: "user",
          parts: parts,
        });
        break;
      case MessageRole.Assistant:
        contents.push({
          role: "model",
          parts: parts,
        });
        break;
      default:
    }
  }

  if (makeSystemPrompt && systemPrompt.parts.length > 0) {
    return [contents, systemPrompt];
  }
  if (systemPrompt.parts.length > 0) {
    return [[systemPrompt, ...contents]];
  }
  return [contents];
}

/** Google Client wrapper */
export class GoogleClient extends BaseClient<
  GenerateContentRequest,
  GenerateContentResult,
  GoogleClientOptions
> {
  private googleConfig;

  constructor(
    googleAPIKey: string,
    model: ModelType,
    options?: GoogleClientOptions
  ) {
    super(model, options);

    this.googleConfig = new GoogleGenerativeAI(googleAPIKey);
  }

  /**
   * Create a chat completion.
   * @param request ChatCompletionCreateParamsNonStreaming
   * @returns Promise<ChatCompletion>
   */
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    console.log("raw request", JSON.stringify(request, null, 2));
    // system instruction is only available in Gemini 1.5, so we just pass it as normal user input for older models
    const [contents, systemPrompt] = parseContents(
      request.messages,
      this.model === ModelType.GEMINI15
    );
    const googleRequest: GenerateContentRequest = {
      contents: contents,
    };
    if (systemPrompt) {
      googleRequest.systemInstruction = systemPrompt;
    }

    console.log("googleRequest", JSON.stringify(googleRequest, null, 2));
    // const tokens = estimateTokens(googleRequest);
    // const response = await this.enqueue(tokens, googleRequest);
    const response = await this.enqueue(1000, googleRequest);
    console.log("raw response", JSON.stringify(response, null, 2));
    const chatResponse = {
      //TODO usage
      messages: [
        {
          content: response.response.text(),
          role: MessageRole.Assistant,
        } as Message,
      ],
    } as ChatCompletionResponse;
    console.log("sagentic response", JSON.stringify(chatResponse, null, 2));
    return chatResponse;
  }

  protected async makeAPIRequest(
    request: GenerateContentRequest
  ): Promise<GenerateContentResult> {
    return this.googleConfig
      .getGenerativeModel({ model: this.model })
      .generateContent(request);
  }

  protected parseError(error: any): RejectionReason {
    //TODO actually check and parse error
    console.log("parseError", error);
    return RejectionReason.UNKNOWN;
  }
}
