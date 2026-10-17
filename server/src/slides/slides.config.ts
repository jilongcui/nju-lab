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
/** 分级用模型（可选）：大纲 / 扩写可以各用各的；缺省回落 SLIDES_MODEL */
export const SLIDES_OUTLINE_MODEL = process.env.SLIDES_OUTLINE_MODEL || '';
export const SLIDES_EXPAND_MODEL = process.env.SLIDES_EXPAND_MODEL || '';

/**
 * reasoning_effort：deepseek-flash / v4-pro 是**推理模型**，completion 预算是
 * 「推理 + 正文」共用的 —— 2026-09-29 实测 max_tokens=200 全被 reasoning_content 烧完、
 * content 为空。结构化 JSON 任务不需要长推理，默认 low（合法值见下，实测自官方 API）。
 */
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type SlidesReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const SLIDES_LLM_REASONING_EFFORT: SlidesReasoningEffort = (
  REASONING_EFFORTS as readonly string[]
).includes(process.env.SLIDES_LLM_REASONING_EFFORT ?? '')
  ? (process.env.SLIDES_LLM_REASONING_EFFORT as SlidesReasoningEffort)
  : 'low';

/** 单次生成的页数上限（提示词里也会写，这里是硬闸） */
export const SLIDES_MAX_SLIDES = num('SLIDES_MAX_SLIDES', 20);
/**
 * 单次请求的 completion 上限（含推理开销，见上）。
 * 2026-09-30：模型上下文已支持 500K tokens，旧的 4000 预算会把大纲/扩写 JSON 截断
 * （实测表现为「内容没生成完就结束了」—— salvage 抢救回少量页、其余走大纲骨架兜底），
 * 默认放开到 32768；截断抢救与局部重试机制保留作兜底。
 */
export const SLIDES_MAX_TOKENS = num('SLIDES_MAX_TOKENS', 32768);
/** 扩写阶段每批页数 */
export const SLIDES_EXPAND_BATCH = num('SLIDES_EXPAND_BATCH', 4);
/** 成本护栏：每课程每小时的生成次数上限（计数落 DB，不引 Redis） */
export const SLIDES_GENERATE_PER_HOUR = num('SLIDES_GENERATE_PER_HOUR', 20);
/** 规整上限：单页要点数 / 单条字符数 / 单页备注字符数 */
export const SLIDES_MAX_BULLETS = num('SLIDES_MAX_BULLETS', 8);
export const SLIDES_MAX_CHARS = num('SLIDES_MAX_CHARS', 400);
export const SLIDES_MAX_NOTES = num('SLIDES_MAX_NOTES', 1000);
/** 生成器后置质检闸（只作用于 LLM 产出，教师手工编辑不受此限）：标题 / 单条要点字符 */
export const SLIDES_TITLE_MAX_CHARS = num('SLIDES_TITLE_MAX_CHARS', 30);
export const SLIDES_BULLET_MAX_CHARS = num('SLIDES_BULLET_MAX_CHARS', 60);
/**
 * 分节页「本节导览」条数硬闸：prompt（v8 起）约定 2–3 条纯关键词，但条数不靠模型自觉
 * （实测单页重生成时扩写模型会写出 4 条），超出在管线内截断。
 */
export const SLIDES_SECTION_TEASER_MAX = num('SLIDES_SECTION_TEASER_MAX', 3);
/**
 * 送入模型的章节正文字符上限（超长截断，避免单次请求过大）。
 * 2026-09-30：随模型 500K token 上下文从 12000 放开到 300000 —— 按中文约 1 字 ≈ 1 token
 * 估算，给 prompt 与输出留足余量；此前长章节在 12000 字处被截断，幻灯片只覆盖前半部分。
 */
export const SLIDES_SOURCE_MAX_CHARS = num('SLIDES_SOURCE_MAX_CHARS', 300_000);
/**
 * 请求超时（毫秒）。token 预算放大后单次响应明显变长（大纲/扩写可达数万 token），
 * 旧的 90s 会中途 abort，默认放宽到 5 分钟。
 */
export const SLIDES_LLM_TIMEOUT_MS = num('SLIDES_LLM_TIMEOUT_MS', 300_000);
/**
 * 提示词版本 —— **改了 prompt 必须 +1**，否则 `sourceHash` 命中旧缓存、教师看不到新效果。
 * v2（2026-09-29）：密度硬约束（≤20字/条、3–5条/页）、keyPoint 锚点、覆盖与去重规则、
 * 讲稿式 notes；配套修复推理模型预算（reasoning_effort=low）与大纲 2000 token 截断。
 * v3（2026-09-29）：版式系统升级 —— 新增 agenda/steps/stat/compare 与 kicker 眉题，
 * 大纲要求按内容选型（版式多样），扩写给各版式的字段契约。
 * v4（2026-09-30）：图片版式 —— 新增 image-full/image-left/image-right/image-grid；
 * 正文含 `file:` 插图时允许模型选用图片版式（url 仅限清单内），无图时维持禁令。
 * v5（2026-09-30）：扩写 prompt 禁止空占位字段（实测模型会把完整 schema 抄成空壳，
 * 如 "compare": {"left": [], "right": []} 挂在无关页上）；配套校验层对非 compare 页的
 * 空 compare 宽容丢弃，扩写失败页先降级为要点页再退回大纲骨架。
 * v6（2026-09-30）：仪式型页面规则 —— cover/section 不写 bullets（此前扩写会把大纲
 * 锚点要点原样 echo 上屏，单页重生成时尤其明显）；agenda 照大纲保留、end 给小结要点；
 * 大纲侧同步声明 cover/section 不必给 bullets；骨架兜底与单页重生成锚点同口径清理。
 * v7（2026-09-30）：section 要点回归 —— 教师侧确认分节页要保留"本节导览"要点
 * （2–4 条、改写成真正预告本节内容、不照抄 keyPoint 锚点），仅视觉弱化（deck-teaser）；
 * v6 的"section 也不写"收得过紧，cover 维持不写。
 * v8（2026-09-30）：section 导览要点收敛为极简关键词风 —— 2–3 条、每条 ≤12 字、
 * 一行一个主题词、禁冒号补充结构（v7 的 2–4 条×20 字带补充说明，教师嫌啰嗦；
 * 参照早期大纲锚点的简洁感，但要求真正点名本节主题词）。
 * v9（2026-10-13）：文风与内容量**回摆**。教师反馈 v8 之后的收紧让内容变差了 ——
 * 「每页内容太少、语言太精简、太口语化、太抽象」。v9 因此：取消"一页最多 3 个块"、
 * evidence 从"≤20 字电报体"改为「3–5 条、每条一个**完整短句**（≤28 字）」、code 回 ≤18 行、
 * 大纲恢复「一页讲透一个要点、内容要充实」；并**新增语言风格铁律**（完整规范的书面表达、
 * 不口语化/不俏皮/术语首次给全称、抽象结论必须带具体对象或数字、讲稿要求表述规范）。
 * 仅保留「同一页不要既有代码又有图片」这一条（防顶掉页脚）。
 * v10（2026-10-13）：补 v9 的副作用 —— v9 把 notes 要求提到「4–7 句、规范完整」后，
 * 模型会在封面/目录/分节这类"没内容的页"**直接不写 notes**（实测第 2 章前 4 页 notes 全空）。
 * v10 显式要求「每一页都必须写 notes、不许留空」并说明仪式页该写什么；
 * 同时规定 lede 必须给出本页结论、不许写成「本节说明…」的目录式提示（v9 的 lede 太生硬）；
 * schema 侧新增校验：notes 缺失或 <40 字 → 进 warnings 提示教师补。
 * v11（2026-10-13）：文风不再"禁口语"。教师对比后认为：**用贴近口语的完整表述解释抽象概念
 * 是优点**（"把规则写死"比"基于确定性规则的判定逻辑"更好懂），v10 的"不要口语化"收得过头。
 * v11 改为「规范、完整、准确，同时要好懂」：允许贴近口语的完整表述，只禁俏皮比喻/网络用语/
 * 玩笑话与公文腔；讲稿也明确"就像在讲课"。内容量与防溢出规则不变。
 * v12（2026-10-17）：讲稿**分两层**。实测 v11 的讲稿混着两种东西：可照读的口播，和「先给学员
 * 一个隐喻」「提醒学员留意」「思考题第一题就是从这儿出的」这类**面向讲者的备课提示**（227 页里
 * 44 页出现第三人称"学员/学生"，占比 ≈19%）—— 教师反映"像是老师的思考而不是能念的稿子"。
 * v12 把口径钉死：**口播必须是能照着念的第一人称讲解**（含 `[ ]` 的文本删掉后仍通顺），
 * **备课提示一律用半角方括号 `[ ]` 内联**（动作/节奏、易错点、与思考题或实验的呼应；
 * 每页 ≤2 处、每处 ≤30 字），口播正文里不许出现第三人称"学员/学生"；
 * 句数口径统一为 4–7 句（v11 里铁律 4 写 4–7 句、铁律 6 写 3–6 句，自相矛盾）。
 * 配套：schema 侧对"口播里混进面向讲者的话"记 warning；渲染侧把 `[ ]` 弱化成 `.notes-cue`
 * （讲稿浮层与 PDF 备注页，见 `web/src/slides/notesCue.ts`）—— 讲者一眼分得清哪些要念、哪些别念。
 * v13（2026-10-17）：**页面结构与图文排布的教师反馈**（v12 之后这一轮）：
 * ① **封面不放要点** —— 封面只有 kicker/title/lede，`plan` 留空（此前 cover→evidence，
 *    封面上挂 4 条要点，教师要求"封面就不要列主题下面的要点了"）；
 * ② **分节页要点回归极简** —— 2–3 条 ≤12 字的主题词短语（v9 起写成完整短句，一页 4–5 条太啰嗦）；
 * ③ **表格页可带图** —— 正文里与表格同段落的插图跟那一页走（plan 写 table + image），
 *    渲染时图排在表格**下方**（此前"一页只能一种块"把表和图拆成两页，教师要求自动判断）；
 * ④ 文风**允许贴切类比/生活化场景**（"单个 Agent 像一名员工"），只禁网络用语与玩笑；
 *    同时强调页面文字也要把话说完整（简洁 ≠ 关键词串）。
 * 配套：schema 侧允许 cover 的空 blocks（不按"没有可用内容块"丢页）；渲染层新增
 * `.ly-figs-below`（表格页/多图页的图排在内容下方，单图 + 代码页仍并排防溢出）。
 */
export const SLIDES_PROMPT_VERSION = 'v13';

/**
 * 每份 deck 保留的历史版本上限（超出删最旧的）。
 * 历史版本是"后悔药"，不是归档系统 —— 20 版足够覆盖一轮备课的反复调整。
 */
export const MAX_DECK_VERSIONS = 20;

/**
 * 生成语义模型（v2）：新生成的 deck 直接产出 `intent + blocks`（见 semantic.schema.ts），
 * 版式由渲染层映射 —— 这是 2026-10-10 起的产品口径。
 * 置 `SLIDES_SEMANTIC=0` 可回退到旧模型（16 种版式枚举）生成，用于应急。
 */
export const SLIDES_SEMANTIC = process.env.SLIDES_SEMANTIC !== '0';

export const SLIDES_LIMITS = {
  maxSlides: SLIDES_MAX_SLIDES,
  maxBullets: SLIDES_MAX_BULLETS,
  maxChars: SLIDES_MAX_CHARS,
  maxNotes: SLIDES_MAX_NOTES,
} as const;
