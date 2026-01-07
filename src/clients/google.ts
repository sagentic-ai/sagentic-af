// SPDX-License-Identifier: BUSL-1.1

import {
  GoogleGenerativeAI,
  GenerateContentRequest,
  GenerateContentResult,
  Content,
  TextPart,
  FunctionCallPart,
  FunctionResponsePart,
  FunctionCallingMode as Mode,
  FunctionCallingConfig,
} from "@google/generative-ai";
import { ModelMetadata, BuiltinModel } from "../models";
import {
  Client,
  GoogleClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ToolMode,
} from "./common";
import { BaseClient, RejectionReason, RequestTimeoutError } from "./base";
import { Message, MessageRole, ContentPart, TextContentPart } from "../thread";
import log from "loglevel";

/**
 * Parse the messages from sagentic format to google format
 */
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
    const toolCalls =
      message.tool_calls?.map((tool_call: any) => {
        return {
          functionCall: {
            name: tool_call.function.name,
            args: JSON.parse(tool_call.function.arguments),
          },
        } as FunctionCallPart;
      }) || [];

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
          parts: [...parts, ...toolCalls],
        });
        break;
      case MessageRole.Tool:
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: message.tool_call_id,
                response: {
                  content: JSON.parse(message.content as string),
                },
              },
            } as FunctionResponsePart,
          ],
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
  private url: string; //endpoint url

  /**
   * Constructor for GoogleClient
   * @param googleAPIKey Google API Key
   * @param model ModelMetadata
   * @param options GoogleClientOptions
   */
  constructor(
    googleAPIKey: string,
    model: ModelMetadata,
    options?: GoogleClientOptions
  ) {
    super(model, options);

    this.url = options?.endpointURL || model.provider.url;
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
    // system instruction is only available in Gemini 1.5, so we just pass it as normal user input for older models
    const [contents, systemPrompt] = parseContents(
      request.messages,
      this.model.id === BuiltinModel.GEMINI15
    );
    const tools = request.options?.tools?.map((tool: any) => {
      const parameters = tool.function.parameters;
      delete parameters["additionalProperties"];
      return {
        name: tool.function.name,
        description: tool.function.description,
        parameters: parameters,
      };
    });
    const googleRequest: GenerateContentRequest = {
      contents: contents,
    };
    if (systemPrompt) {
      googleRequest.systemInstruction = systemPrompt;
    }
    if (tools && tools.length > 0) {
      googleRequest.tools = [
        {
          functionDeclarations: tools,
        },
      ];
      if (request.options?.tool_choice) {
        let functionCallingConfig: FunctionCallingConfig;
        switch (request.options.tool_choice) {
          case ToolMode.AUTO:
            functionCallingConfig = {
              mode: Mode.AUTO,
            };
            break;
          case ToolMode.NONE:
            functionCallingConfig = {
              mode: Mode.NONE,
            };
            break;
          case ToolMode.REQUIRED:
            functionCallingConfig = {
              mode: Mode.ANY,
            };
            break;
          default: // ToolChoice
            functionCallingConfig = {
              mode: Mode.ANY,
              allowedFunctionNames: [ request.options.tool_choice.function.name ],
            };
          }
        googleRequest.toolConfig = {
          functionCallingConfig: functionCallingConfig,
        };
      } 
    }

    // const tokens = estimateTokens(googleRequest);
    // const response = await this.enqueue(tokens, googleRequest);
    const response = await this.enqueue(1000, googleRequest);
    const functionCall =
      response.response?.candidates?.[0].content.parts?.[0].functionCall;
    let chatResponse: ChatCompletionResponse;
    if (functionCall) {
      const toolCall = {
        id: functionCall.name,
        type: "function",
        function: {
          name: functionCall.name,
          arguments: JSON.stringify(functionCall.args),
        },
      };
      chatResponse = {
        //TODO usage
        messages: [
          {
            tool_calls: [toolCall],
            role: MessageRole.Assistant,
          } as Message,
        ],
      } as ChatCompletionResponse;
    } else {
      chatResponse = {
        //TODO usage
        messages: [
          {
            content: response.response.text(),
            role: MessageRole.Assistant,
          } as Message,
        ],
      } as ChatCompletionResponse;
    }
    return chatResponse;
  }

  /**
   * Make request to the API
   */
  protected async makeAPIRequest(
    request: GenerateContentRequest,
    signal?: AbortSignal
  ): Promise<GenerateContentResult> {
    const model = this.googleConfig.getGenerativeModel(
      { model: this.model.card.checkpoint },
      { baseUrl: this.url }
    );

    // Google SDK accepts abort signal via requestOptions
    const requestOptions = signal ? { signal } : undefined;
    return model.generateContent(request, requestOptions);
  }

  /**
   * Parse the error from the API
   */
  protected parseError(error: any): RejectionReason {
    // Check for request timeout (defends against hung connections like Deno fetch bug)
    if (error instanceof RequestTimeoutError) {
      return RejectionReason.TIMEOUT;
    }

    //TODO actually check and parse error
    // if contains 429 Too Many Requests, return RejectionReason.RATE_LIMIT
    if (error.message && error.message.includes("429 Too Many Requests")) {
      return RejectionReason.TOO_MANY_REQUESTS;
    }

    log.error("unknown Google error", error);

    return RejectionReason.UNKNOWN;
  }
}
