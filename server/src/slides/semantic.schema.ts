/**
 * 语义幻灯片模型（v2）—— 服务端的**结构与校验**，与前端 `web/src/slides/semantic/types.ts` 一一对应。
 *
 * 为什么换掉旧模型：旧模型是**版式导向**的（`layout + bullets/stats/compare` 共 16 种枚举），
 * 模型得同时决定"讲什么"和"用哪个版式"，于是既写不出关系图/管线，也常常把内容塞进要点。
 * 新模型是**语义导向**的：模型只表达「这页要完成什么（intent）」与「由哪些内容块构成（blocks）」，
 * 版式由渲染层映射（见 `docs/DESIGN-2026-10-10-slides-semantic-html.md`）。
 *
 * 与旧模型的关系：**共用同一个 `slide_decks.slides` JSON 列**，靠结构自辨识（有 `intent` 即 v2），
 * 因此**不需要数据库迁移**；旧 deck 由前端适配器渲染，教师无需重生成。
 */

export const SEMANTIC_INTENTS = [
  'cover',
  'toc',
  'section',
  'claim',
  'contrast',
  'pillars',
  'metric',
  'sequence',
  'flow',
  'arch',
  'relation',
  'timeline',
  'table',
  'data',
  'example',
  'quote',
  'image',
  'summary',
] as const;
export type SemanticIntent = (typeof SEMANTIC_INTENTS)[number];

export const SEMANTIC_BLOCK_KINDS = [
  'claim',
  'evidence',
  'metric',
  'sequence',
  'flow',
  'arch',
  'relation',
  'timeline',
  'compare',
  'table',
  'chart',
  'formula',
  'code',
  'quote',
  'image',
  'note',
] as const;
export type SemanticBlockKind = (typeof SEMANTIC_BLOCK_KINDS)[number];

export type SemanticBlock = Record<string, unknown> & { kind: SemanticBlockKind };

export interface SemanticPage {
  /** 稳定 id（前端缩略图/编辑态以它做 key；重生成时保留原 id） */
  id?: string;
  intent: SemanticIntent;
  kicker?: string;
  title?: string;
  subtitle?: string;
  lede?: string;
  number?: string;
  blocks: SemanticBlock[];
  /** 整页背景（图片铺满 + 压暗遮罩）；封面/分节页常用 */
  background?: { fileId: string; dim?: number; blur?: boolean };
  notes?: string;
}

const INTENT_SET = new Set<string>(SEMANTIC_INTENTS);
const BLOCK_SET = new Set<string>(SEMANTIC_BLOCK_KINDS);

/** 块级预算：固定 1920×1080 画布下这些是**可计算**的，超了裁剪并记 warning */
const BUDGET = {
  evidenceItems: 5,
  evidenceChars: 30,
  claimChars: 60,
  metricItems: 4,
  sequenceItems: 6,
  flowNodes: 5,
  archLevels: 3,
  archCells: 4,
  relationNodes: 6,
  timelinePoints: 6,
  tableRows: 6,
  tableCols: 6,
  chartLabels: 8,
  chartSeries: 3,
  formulaChars: 400,
  codeLines: 20,
  compareItems: 5,
  titleChars: 40,
  ledeChars: 90,
  noteChars: 120,
} as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 400): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function strList(value: unknown, max: number, chars: number = BUDGET.evidenceChars): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => str(item, chars * 4))
    .filter((item): item is string => !!item)
    .slice(0, max);
}

/** 结构自辨识：v2 deck 的每页都有 intent 字段 */
export function isSemanticDeck(slides: unknown): slides is SemanticPage[] {
  return Array.isArray(slides) && slides.length > 0 && slides.every((page) => isRecord(page) && typeof page.intent === 'string');
}

/** 宽松 JSON 解析（模型偶尔在字符串内部留未转义引号 —— 中文语料里很常见） */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        if (!inString) {
          inString = true;
          out += ch;
          continue;
        }
        let j = i + 1;
        while (j < trimmed.length && /\s/.test(trimmed[j])) j += 1;
        const next = trimmed[j];
        if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
          inString = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
    }
    return JSON.parse(out);
  }
}

function normalizeBlock(raw: unknown, warnings: string[], pageNo: number): SemanticBlock | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || !BLOCK_SET.has(raw.kind)) return null;
  const kind = raw.kind as SemanticBlockKind;
  switch (kind) {
    case 'claim': {
      // 空主张 = 空块（否则会渲染出一个只有标题的空页）
      const text = str(raw.text, BUDGET.claimChars * 2);
      return text ? { kind, text } : null;
    }
    case 'evidence': {
      const items = strList(raw.items, BUDGET.evidenceItems);
      if (!items.length) return null;
      return { kind, items };
    }
    case 'metric': {
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .filter(isRecord)
        .map((item) => ({
          value: str(item.value, 40) ?? '',
          unit: str(item.unit, 8),
          label: str(item.label, 40) ?? '',
          detail: str(item.detail, 40),
          tone: ['up', 'down', 'neutral'].includes(String(item.tone)) ? item.tone : undefined,
        }))
        .filter((item) => item.value && item.label)
        .slice(0, BUDGET.metricItems);
      if (!items.length) return null;
      return { kind, items };
    }
    case 'sequence': {
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .filter(isRecord)
        .map((item) => ({ title: str(item.title, 30) ?? '', desc: str(item.desc, 60), tag: str(item.tag, 20) }))
        .filter((item) => item.title)
        .slice(0, BUDGET.sequenceItems);
      if (!items.length) return null;
      return { kind, items };
    }
    case 'flow': {
      const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
        .filter(isRecord)
        .map((node) => ({ title: str(node.title, 30) ?? '', desc: str(node.desc, 40), highlight: node.highlight === true }))
        .filter((node) => node.title)
        .slice(0, BUDGET.flowNodes);
      if (nodes.length < 2) return null;
      // 高亮最多一个（否则整页没有主次）
      let highlighted = false;
      for (const node of nodes) {
        if (node.highlight && highlighted) node.highlight = false;
        else if (node.highlight) highlighted = true;
      }
      return { kind, nodes };
    }
    case 'arch': {
      const levels = (Array.isArray(raw.levels) ? raw.levels : [])
        .filter(isRecord)
        .map((level) => ({
          name: str(level.name, 20) ?? '',
          highlight: level.highlight === true,
          cells: (Array.isArray(level.cells) ? level.cells : [])
            .filter(isRecord)
            .map((cell) => ({ title: str(cell.title, 24) ?? '', desc: str(cell.desc, 40) }))
            .filter((cell) => cell.title)
            .slice(0, BUDGET.archCells),
        }))
        .filter((level) => level.name && level.cells.length)
        .slice(0, BUDGET.archLevels);
      if (!levels.length) return null;
      return { kind, levels };
    }
    case 'relation': {
      const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
        .filter(isRecord)
        .map((node) => ({ label: str(node.label, 24) ?? '', desc: str(node.desc, 40), center: node.center === true }))
        .filter((node) => node.label)
        .slice(0, BUDGET.relationNodes);
      if (nodes.length < 2) return null;
      // 中心节点有且只有一个
      const centers = nodes.filter((node) => node.center);
      if (centers.length !== 1) nodes.forEach((node, i) => (node.center = i === 0));
      return { kind, nodes };
    }
    case 'timeline': {
      const points = (Array.isArray(raw.points) ? raw.points : [])
        .filter(isRecord)
        .map((point) => ({
          at: str(point.at, 16) ?? '',
          title: str(point.title, 30) ?? '',
          desc: str(point.desc, 50),
          highlight: point.highlight === true,
        }))
        .filter((point) => point.title)
        .slice(0, BUDGET.timelinePoints);
      if (points.length < 2) return null;
      return { kind, points };
    }
    case 'compare': {
      const side = (value: unknown, tone: string) => {
        if (!isRecord(value)) return null;
        const items = strList(value.items, BUDGET.compareItems);
        if (!items.length) return null;
        const rawTone = String(value.tone);
        return {
          title: str(value.title, 30) ?? '',
          items,
          tone: ['up', 'down', 'accent', 'neutral'].includes(rawTone) ? rawTone : tone,
        };
      };
      const left = side(raw.left, 'accent');
      const right = side(raw.right, 'accent');
      if (!left || !right) return null;
      return { kind, left, right };
    }
    case 'table': {
      const head = strList(raw.head, BUDGET.tableCols, 24);
      const rows = (Array.isArray(raw.rows) ? raw.rows : [])
        .filter(Array.isArray)
        .map((row) => strList(row, BUDGET.tableCols, 40))
        .filter((row) => row.length)
        .slice(0, BUDGET.tableRows);
      if (!head.length || !rows.length) return null;
      const align = Array.isArray(raw.align) ? raw.align.map((value) => (value === 'r' ? 'r' : 'l')) : undefined;
      return { kind, head, rows, align };
    }
    case 'code': {
      const content = typeof raw.content === 'string' ? raw.content.replace(/\r\n?/g, '\n') : '';
      const lines = content.split('\n').slice(0, BUDGET.codeLines);
      if (!content.trim()) return null;
      return { kind, lang: str(raw.lang, 16) ?? 'text', content: lines.join('\n'), caption: str(raw.caption, 80) };
    }
    case 'quote': {
      const text = str(raw.text, 160);
      if (!text) return null;
      return { kind, text, cite: str(raw.cite, 40) };
    }
    case 'image': {
      const fileId = str(raw.fileId, 64) ?? '';
      if (!/^[0-9a-fA-F-]{36}$/.test(fileId)) {
        warnings.push(`第 ${pageNo} 页的图片引用非法，已忽略该图`);
        return null;
      }
      const role = ['hero', 'inline', 'full', 'grid'].includes(String(raw.role)) ? String(raw.role) : 'inline';
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .filter(isRecord)
        .map((item) => ({ fileId: str(item.fileId, 64) ?? '', caption: str(item.caption, 60) }))
        .filter((item) => /^[0-9a-fA-F-]{36}$/.test(item.fileId))
        .slice(0, 4);
      return { kind, fileId, caption: str(raw.caption, 80), role, items: items.length ? items : undefined };
    }
    case 'chart': {
      const chart = ['bar', 'line', 'donut'].includes(String(raw.chart)) ? String(raw.chart) : 'bar';
      const labels = strList(raw.labels, BUDGET.chartLabels, 24);
      const series = (Array.isArray(raw.series) ? raw.series : [])
        .filter(isRecord)
        .map((item) => ({
          name: str(item.name, 24),
          values: (Array.isArray(item.values) ? item.values : []).map((value) => Number(value)).filter((value) => Number.isFinite(value)),
        }))
        .filter((item) => item.values.length)
        .slice(0, BUDGET.chartSeries);
      if (!labels.length || !series.length) return null;
      const highlight = Number.isInteger(raw.highlight) ? Number(raw.highlight) : undefined;
      return {
        kind,
        chart,
        labels,
        series,
        unit: str(raw.unit, 8),
        highlight: highlight !== undefined && highlight >= 0 && highlight < labels.length ? highlight : undefined,
      };
    }
    case 'formula': {
      const tex = typeof raw.tex === 'string' ? raw.tex.trim().slice(0, BUDGET.formulaChars) : '';
      if (!tex) return null;
      return { kind, tex, caption: str(raw.caption, 80) };
    }
    case 'note': {
      const text = str(raw.text, BUDGET.noteChars);
      return text ? { kind, text } : null;
    }
    default:
      return null;
  }
}

/** 校验 + 规整（页数、intent 白名单、每块预算；非法块丢弃并记 warning，绝不渲染畸形结构） */
export function validateSemanticPages(
  raw: unknown,
  limits: { maxPages: number; maxNotes: number },
): { pages: SemanticPage[]; warnings: string[] } {
  const warnings: string[] = [];
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.pages) ? raw.pages : [];
  const pages: SemanticPage[] = [];
  list.slice(0, limits.maxPages).forEach((item, index) => {
    const pageNo = index + 1;
    if (!isRecord(item)) {
      warnings.push(`第 ${pageNo} 页结构非法，已跳过`);
      return;
    }
    const intent = typeof item.intent === 'string' && INTENT_SET.has(item.intent) ? (item.intent as SemanticIntent) : 'claim';
    if (intent !== item.intent) warnings.push(`第 ${pageNo} 页 intent 非法（${String(item.intent)}），已按 claim 处理`);
    const blocks = (Array.isArray(item.blocks) ? item.blocks : [])
      .map((block) => normalizeBlock(block, warnings, pageNo))
      .filter((block): block is SemanticBlock => !!block);
    if (!blocks.length) {
      warnings.push(`第 ${pageNo} 页没有可用内容块，已跳过`);
      return;
    }
    const notes = str(item.notes, limits.maxNotes);
    const backgroundRaw = isRecord(item.background) ? item.background : null;
    const backgroundFileId = backgroundRaw ? (str(backgroundRaw.fileId, 64) ?? '') : '';
    const background =
      backgroundFileId && /^[0-9a-fA-F-]{36}$/.test(backgroundFileId)
        ? {
            fileId: backgroundFileId,
            dim: typeof backgroundRaw?.dim === 'number' ? Math.min(Math.max(backgroundRaw.dim, 0), 0.9) : undefined,
            blur: backgroundRaw?.blur === true,
          }
        : undefined;
    if (backgroundRaw && !background) warnings.push(`第 ${pageNo} 页的背景图引用非法，已忽略`);
    pages.push({
      id: str(item.id, 64),
      intent,
      kicker: str(item.kicker, 24),
      title: str(item.title, BUDGET.titleChars),
      subtitle: str(item.subtitle, BUDGET.ledeChars),
      lede: str(item.lede, BUDGET.ledeChars),
      number: str(item.number, 8),
      blocks,
      background,
      notes,
    });
  });
  if (list.length > limits.maxPages) {
    warnings.push(`页数超过上限（${list.length} > ${limits.maxPages}），已截断`);
  }
  return { pages, warnings };
}

/** 只读投影：语义 deck → 可读 Markdown（教师端"只读预览"用；**不接受回写**） */
export function semanticToMarkdown(pages: SemanticPage[]): string {
  const lines: string[] = ['<!-- 本 deck 由语义模型（v2）生成：Markdown 仅作只读预览，改动请用「换主题 / 重生成本页」 -->'];
  for (const page of pages) {
    lines.push('', `<!-- .slide: intent=${page.intent} -->`);
    if (page.kicker) lines.push(`> ${page.kicker}`);
    if (page.title) lines.push(`# ${page.title}`);
    if (page.lede) lines.push(`_${page.lede}_`);
    for (const block of page.blocks) {
      const kind = String(block.kind);
      if (kind === 'evidence' || kind === 'sequence') {
        const items = (block.items as unknown[]) ?? [];
        for (const item of items) {
          if (typeof item === 'string') lines.push(`- ${item}`);
          else if (isRecord(item) && typeof item.title === 'string') lines.push(`- ${item.title}${item.desc ? `：${String(item.desc)}` : ''}`);
        }
      } else if (kind === 'claim' || kind === 'note') {
        if (typeof block.text === 'string') lines.push('', block.text);
      } else if (kind === 'metric') {
        for (const item of (block.items as Record<string, unknown>[]) ?? []) {
          lines.push(`- **${String(item.value)}${item.unit ? String(item.unit) : ''}** ${String(item.label)}${item.detail ? `（${String(item.detail)}）` : ''}`);
        }
      } else if (kind === 'table') {
        const head = (block.head as string[]) ?? [];
        lines.push('', `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
        for (const row of (block.rows as string[][]) ?? []) lines.push(`| ${row.join(' | ')} |`);
      } else if (kind === 'code') {
        lines.push('', '```' + String(block.lang ?? 'text'), String(block.content ?? ''), '```');
      } else if (kind === 'quote') {
        lines.push('', `> ${String(block.text ?? '')}`);
      } else if (kind === 'compare') {
        const left = block.left as { title?: string; items?: string[] } | undefined;
        const right = block.right as { title?: string; items?: string[] } | undefined;
        lines.push('', `**${left?.title ?? 'A'}**`, ...(left?.items ?? []).map((i) => `- ${i}`));
        lines.push('', `**${right?.title ?? 'B'}**`, ...(right?.items ?? []).map((i) => `- ${i}`));
      } else if (kind === 'flow') {
        const nodes = (block.nodes as { title?: string }[]) ?? [];
        lines.push('', nodes.map((n) => String(n.title ?? '')).join(' → '));
      } else if (kind === 'relation') {
        const nodes = (block.nodes as { label?: string; center?: boolean }[]) ?? [];
        lines.push('', nodes.map((n) => `${n.center ? '【中心】' : '·'}${String(n.label ?? '')}`).join('  '));
      } else if (kind === 'arch') {
        for (const level of (block.levels as { name?: string; cells?: { title?: string }[] }[]) ?? []) {
          lines.push(`- ${String(level.name)}：${(level.cells ?? []).map((c) => String(c.title ?? '')).join(' / ')}`);
        }
      } else if (kind === 'timeline') {
        for (const point of (block.points as { at?: string; title?: string }[]) ?? []) {
          lines.push(`- ${String(point.at)}｜${String(point.title)}`);
        }
      }
    }
    if (page.notes) lines.push('', `<!-- .notes: ${page.notes} -->`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 生成 prompt（2026-10-10 用真实模型离线验证过的版本）

export const SEMANTIC_OUTLINE_SYSTEM = [
  '你是大学课程的教学课件设计助手：把一章正文转成在线演示的**页面计划**。',
  '只输出一个 JSON 对象，不要任何解释文字。结构：',
  '{"deckTitle": string, "pages": [{"intent": string, "kicker": string, "title": string, "lede": string, "keyPoint": string, "plan": string[]}]}',
  `intent 只能取：${SEMANTIC_INTENTS.join(' | ')}。`,
  'plan 是本页要用的内容块类型，从 claim/evidence/metric/sequence/flow/arch/relation/timeline/compare/table/chart/formula/code/quote/note 里选 1–2 个。',
  '',
  '【整体结构】',
  '1) 第 1 页 intent=cover（title 用章节名，kicker 用课程名，lede 一句话交代本章要解决什么）；',
  '第 2 页 intent=toc 作「本章脉络」；最后一页 intent=summary 作小结。首尾页都不许省。',
  '2) 通读正文，梳理 2–4 个分节：每节用一页 intent=section 打头（kicker 写「第 N 节」，lede 一句话说清本节要讲清什么），',
  '其下跟 1–3 页内容页。短章可省分节页，把页数让给内容页。',
  '',
  '【选型——这是本任务的重点，务必按内容形态选，不要一水儿 claim】',
  '3) 讲清一个论断并给若干支撑 → claim；两件事/两条路线对照 → contrast；并列 2–4 个要素 → pillars；',
  '正文里有 1–4 个关键数字 → metric；有先后顺序的步骤/操作 → sequence；数据在环节间流动的管线 → flow；',
  '分层结构（层 × 组件，如系统栈）→ arch；概念之间的关系（谁依赖谁、一个中心带几个相关概念）→ relation；',
  '时间演化/路线图 → timeline；需要严格对齐的多列数值 → table；**正文里有可以画成图的数值序列就用 data（柱/折线/环形）**；',
  '公式推导 → formula；代码或命令 → example；一句话点睛 → quote。',
  '4) 一份 deck 至少要出现 3 种不同的内容页 intent（不许全是 claim）；relation/flow/arch/timeline 这类"图示页"',
  '只在正文确有相应结构时使用，**不要为了好看硬凑**。',
  `5) 总页数不超过 ${20} 页（含首尾）。`,
  '',
  '【信息密度】',
  '6) keyPoint 用一句话写清「本页要让学员记住什么」（≤40 字），它只给扩写看，不上屏。',
  '7) title ≤30 字，lede ≤60 字（可省）。一页只讲一件事。',
  '',
  '【覆盖与去重】',
  '8) 分节与页面合起来覆盖正文核心知识点，不遗漏；每个知识点只讲一次，标题不许重复或高度相似。',
].join('\n');

export const SEMANTIC_BLOCK_SPEC = [
  'blocks 字段规范（只写本页 intent 需要的，不许写空占位）：',
  '- {"kind":"claim","text":"一句主张，≤40 字，可用 **强调**"}',
  '- {"kind":"evidence","items":["要点 3–5 条，每条 ≤20 字，电报体"]}',
  '- {"kind":"metric","items":[{"value":"0.2761","unit":"%","label":"这个数字是什么","detail":"口径/样本","tone":"up|down"}]}  1–4 个',
  '- {"kind":"sequence","items":[{"title":"步骤名","desc":"一句话","tag":"产物/耗时"}]}  2–6 步',
  '- {"kind":"flow","nodes":[{"title":"环节","desc":"做什么","highlight":true}]}  3–5 个；highlight 最多 1 个',
  '- {"kind":"arch","levels":[{"name":"层名","cells":[{"title":"组件","desc":"一句话"}]}]}  2–3 层 × ≤4 格',
  '- {"kind":"relation","nodes":[{"label":"概念","desc":"一句话","center":true}]}  3–6 个；center 只给 1 个',
  '- {"kind":"timeline","points":[{"at":"时间/阶段","title":"发生了什么","desc":"一句话","highlight":true}]}  3–6 个',
  '- {"kind":"compare","left":{"title":"A","items":["≤4 条"],"tone":"accent|up|down"},"right":{"title":"B","items":["…"]}}',
  '- {"kind":"table","head":["列名"],"rows":[["…"]],"align":["l","r"]}  ≤6 行',
  '- {"kind":"chart","chart":"bar|line|donut","labels":["≤8 个"],"series":[{"name":"系列名","values":[数字]}],"unit":"%","highlight":2}  ≤3 条序列；数值必须来自正文',
  '- {"kind":"formula","tex":"\\frac{QK^\\top}{\\sqrt{d}}","caption":"一句话说明"}  LaTeX 源码',
  '- {"kind":"code","lang":"python","content":"≤18 行代码","caption":"一句话说明"}',
  '- {"kind":"quote","text":"引文或结论","cite":"出处（可省）"}',
  '- {"kind":"note","text":"本页的补充说明（≤60 字，不是讲稿）"}',
].join('\n');

export const SEMANTIC_EXPAND_SYSTEM = [
  '你在为已经定好的页面计划填充内容，产出可直接渲染的幻灯片 JSON。',
  '只输出一个 JSON 对象：{"pages": [{"intent","kicker","title","lede","blocks","notes"}]}，不要解释。',
  '',
  SEMANTIC_BLOCK_SPEC,
  '',
  '【铁律】',
  '1) intent / kicker / title 必须与给定计划**完全一致**，顺序不许变，不许增删页。',
  '2) 数字必须来自正文，不许编造；正文没给的数字就不要写 metric。',
  '3) evidence 每条 ≤20 字、≤5 条；metric ≤4 个；relation ≤6 节点；code ≤18 行。',
  '4) notes 是**讲者讲稿**（3–6 句、口语化、有过渡语、信息量比页面大），不是页面文字的重述。',
  '5) 页面上只写给学员看的内容；面向讲者的话一律进 notes。',
  '6) notes 是**一个字符串**（不是数组），3–6 句连成一段。',
  '7) 字符串内部不要使用英文双引号；需要引用时用中文引号「」。',
  '8) 【intent 与 blocks 必须匹配】cover→evidence；toc→sequence；section→evidence（本节导读，可省）；',
  'claim→claim + evidence；contrast→compare；pillars→sequence 或 evidence；metric→metric；sequence→sequence；',
  'flow→flow；arch→arch；relation→relation；timeline→timeline；table→table；data→chart；formula→formula；',
  'example→code；quote→quote；',
  'summary→claim 或 evidence。除 note（本页补充说明）外，**不要在同一页混入别的块类型**。',
].join('\n');
