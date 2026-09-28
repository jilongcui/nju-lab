import {
  SLIDES_LLM_API_KEY_ENV,
  SLIDES_LLM_BASE_URL,
  SLIDES_LLM_TIMEOUT_MS,
  SLIDES_MAX_TOKENS,
  SLIDES_MODEL,
} from './slides.config';

/**
 * OpenAI 兼容的模型调用（**用 Node 内置 fetch**，平台没装 axios）。
 *
 * 约束：
 *   · key 只从 `process.env[SLIDES_LLM_API_KEY_ENV]` 现读 —— 不落库、不进日志、不回前端
 *   · 只用于产出结构化 JSON（`response_format: json_object`），非 JSON 用途不加
 *   · 超时用 AbortController，错误统一翻译成中文可读信息，便于教师在界面上看到原因
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number } | null;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

/** 当前配置的 key（无则 null）—— 用于 llm 模式下的前置检查与友好报错 */
export function configuredApiKey(): string | null {
  const key = process.env[SLIDES_LLM_API_KEY_ENV];
  return key && key.trim() ? key.trim() : null;
}

/** 诊断信息（不含 key 本身），落库/回前端都安全 */
export function llmDiagnostics(): Record<string, string | boolean> {
  return {
    generator: 'llm',
    baseUrl: SLIDES_LLM_BASE_URL,
    model: SLIDES_MODEL,
    keyEnv: SLIDES_LLM_API_KEY_ENV,
    keyConfigured: !!configuredApiKey(),
  };
}

export async function chatJson(
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<ChatResult> {
  const apiKey = configuredApiKey();
  if (!apiKey) {
    throw new LlmError(
      `未配置 ${SLIDES_LLM_API_KEY_ENV}，无法调用模型；可改用 SLIDES_GENERATOR=mock`,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLIDES_LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${SLIDES_LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: SLIDES_MODEL,
        messages,
        max_tokens: options.maxTokens ?? SLIDES_MAX_TOKENS,
        temperature: options.temperature ?? 0.3,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new LlmError(
        `模型接口返回 HTTP ${response.status}：${text.slice(0, 300) || '(无响应体)'}`,
      );
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new LlmError('模型返回内容为空');
    }
    return {
      content,
      model: payload.model || SLIDES_MODEL,
      usage: payload.usage
        ? {
            promptTokens: payload.usage.prompt_tokens ?? 0,
            completionTokens: payload.usage.completion_tokens ?? 0,
          }
        : null,
    };
  } catch (error) {
    if (error instanceof LlmError) throw error;
    const err = error as Error & { cause?: Error };
    if (err.name === 'AbortError') {
      throw new LlmError(`模型调用超时（${SLIDES_LLM_TIMEOUT_MS}ms）`);
    }
    // 带上端点与底层原因（如 ECONNREFUSED / DNS 失败），否则只剩一句 "fetch failed" 无从排查
    const cause = err.cause?.message ? `（${err.cause.message}）` : '';
    throw new LlmError(
      `模型调用失败（${SLIDES_LLM_BASE_URL}）：${err.message}${cause}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型输出里抠出 JSON：容忍 ```json 围栏与前后闲聊（结构化输出仍可能被包住） */
export function parseJsonLoose(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* 落到下面统一报错 */
      }
    }
    throw new LlmError('模型输出不是合法 JSON');
  }
}
