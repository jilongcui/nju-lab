/**
 * 章节在线幻灯片（reveal.js）—— 配置与开关。
 *
 * 生成器双轨，照搬平台既有的 `EVALUATION_RUNNER=mock|docker` 思路：
 *   SLIDES_GENERATOR=mock|llm   默认 mock —— 开发/测试不烧额度、不需要 key，也能跑通全链路
 *
 * llm 模式走 OpenAI 兼容的 `/chat/completions`，用 **Node 内置 fetch**（平台没装 axios）。
 * 默认模型 `deepseek-flash` 不是猜的：`dsh/profiles/nju-lab-verify/cordis.patch.yml:43` 记着
 * 「DeepSeek 官方实测事实：可用模型 deepseek-flash / deepseek-v4-pro」，同处也说明 baseURL 默认为
 * `https://api.deepseek.com` 且可被 `DEEPSEEK_BASE_URL` 覆盖；回退 Moonshot 时是
 * `https://api.moonshot.cn/v1` + `kimi-k2.6`。
 * 出口可达性也有既有依据：`container-runtime.ts` 的 `VERIFY_EGRESS_DOMAINS` 默认
 * `api.deepseek.com,api.moonshot.cn`，说明这两个域名在本机是可出网的。
 */
export type SlidesGeneratorMode = 'mock' | 'llm';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const SLIDES_GENERATOR: SlidesGeneratorMode =
  process.env.SLIDES_GENERATOR === 'llm' ? 'llm' : 'mock';

/** OpenAI 兼容端点基址（不带尾斜杠） */
export const SLIDES_LLM_BASE_URL = (
  process.env.SLIDES_LLM_BASE_URL ||
  process.env.DEEPSEEK_BASE_URL ||
  'https://api.deepseek.com'
).replace(/\/+$/, '');

/** key 的**变量名**：值只从 process.env 现读，不落库、不进日志、不回前端 */
export const SLIDES_LLM_API_KEY_ENV =
  process.env.SLIDES_LLM_API_KEY_ENV || 'DEEPSEEK_API_KEY';

export const SLIDES_MODEL = process.env.SLIDES_MODEL || 'deepseek-flash';

/** 单次生成的页数上限（提示词里也会写，这里是硬闸） */
export const SLIDES_MAX_SLIDES = num('SLIDES_MAX_SLIDES', 20);
/** 单次请求的 completion 上限 */
export const SLIDES_MAX_TOKENS = num('SLIDES_MAX_TOKENS', 4000);
/** 扩写阶段每批页数 */
export const SLIDES_EXPAND_BATCH = num('SLIDES_EXPAND_BATCH', 4);
/** 成本护栏：每课程每小时的生成次数上限（计数落 DB，不引 Redis） */
export const SLIDES_GENERATE_PER_HOUR = num('SLIDES_GENERATE_PER_HOUR', 20);
/** 规整上限：单页要点数 / 单条字符数 / 单页备注字符数 */
export const SLIDES_MAX_BULLETS = num('SLIDES_MAX_BULLETS', 8);
export const SLIDES_MAX_CHARS = num('SLIDES_MAX_CHARS', 400);
export const SLIDES_MAX_NOTES = num('SLIDES_MAX_NOTES', 1000);
/** 送入模型的章节正文字符上限（超长截断，避免单次请求过大） */
export const SLIDES_SOURCE_MAX_CHARS = num('SLIDES_SOURCE_MAX_CHARS', 12000);
/** 请求超时（毫秒） */
export const SLIDES_LLM_TIMEOUT_MS = num('SLIDES_LLM_TIMEOUT_MS', 90_000);
/**
 * 提示词版本 —— **改了 prompt 必须 +1**，否则 `sourceHash` 命中旧缓存、教师看不到新效果。
 */
export const SLIDES_PROMPT_VERSION = 'v1';

export const SLIDES_LIMITS = {
  maxSlides: SLIDES_MAX_SLIDES,
  maxBullets: SLIDES_MAX_BULLETS,
  maxChars: SLIDES_MAX_CHARS,
  maxNotes: SLIDES_MAX_NOTES,
} as const;
