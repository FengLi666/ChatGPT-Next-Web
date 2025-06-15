"use client";

import {
  ApiPath,
  BEDROCK_BASE_URL,
  Bedrock,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  SpeechOptions,
} from "../api";
import { useAccessStore, useAppConfig, useChatStore } from "@/app/store";
import { stream } from "@/app/utils/chat";
import { fetch } from "@/app/utils/stream";
import { getClientConfig } from "@/app/config/client";
import { getMessageTextContent } from "@/app/utils";

export class BedrockApi implements LLMApi {
  private disableListModels = true;

  path(path: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = "";
    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.bedrockUrl;
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      baseUrl = isApp ? BEDROCK_BASE_URL : ApiPath.Bedrock;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.Bedrock)) {
      baseUrl = "https://" + baseUrl;
    }

    return [baseUrl, path].join("/");
  }

  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  extractMessage(res: any) {
    return res?.content?.[0]?.text;
  }

  async chat(options: ChatOptions): Promise<void> {
    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      messages.push({ role: v.role, content: getMessageTextContent(v) });
    }

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
      },
    };

    const requestPayload = {
      messages,
      stream: options.config.stream,
      model: modelConfig.model,
      max_tokens: modelConfig.max_tokens,
      temperature: modelConfig.temperature,
      top_p: modelConfig.top_p,
    };

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(Bedrock.ChatPath);
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      if (shouldStream) {
        await stream(chatPath, chatPayload, {
          onData: (text, chunk) => {
            options.onUpdate?.(text, chunk);
          },
          onEnd: (text, res) => {
            options.onFinish(text, res);
          },
          onError: (err) => {
            options.onError?.(err);
          },
        });
      } else {
        const res = await fetch(chatPath, chatPayload);
        const resJson = await res.json();
        const message = this.extractMessage(resJson);
        options.onFinish(message, res);
      }

      clearTimeout(requestTimeoutId);
    } catch (e) {
      console.error("failed to chat", e);
      options.onError?.(e as Error);
    }
  }

  async usage() {
    return { used: 0, total: 0 };
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return [];
    }
    return [];
  }
}
