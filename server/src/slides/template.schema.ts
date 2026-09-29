import { DeckConfig } from './deck.schema';

/**
 * 模板设计（"可视化调参"落库的结构化值，见设计文档 §6）。
 *
 * v1 刻意**不存整段 CSS**：教师只调参数，服务端再把参数编译成 CSS 变量与少量规则。
 * 这样做的两个好处：
 *   1) 不用解析/迁移 CSS，加字段就是加字段；
 *   2) **安全边界清晰** —— 所有值都从窄字符集里校验后才进 CSS，杜绝 `;{}<>` 这类注入
 *      （模板是教师写的、但会被学生浏览器执行，这条不能松）。
 */

export interface TemplateDesign {
  primary?: string;
  background?: string;
  text?: string;
  accent?: string;
  fontFamily?: string;
  headingFontFamily?: string;
  footerText?: string;
  /** 页脚 logo：平台 files 里的图片 id（渲染时由前端取内容内联成 data URL） */
  logoFileId?: string | null;
  radius?: number;
  density?: 'compact' | 'cozy' | 'loose';
  /** 字号阶梯：整体基准字号（compact 32px / standard 38px / large 44px） */
  fontScale?: 'compact' | 'standard' | 'large';
  /** 要点/对比栏的卡片化处理：none 朴素列表 | soft 浅色底卡 | outline 描边卡 */
  cardStyle?: 'none' | 'soft' | 'outline';
}

export interface BuiltinTemplateDef {
  id: string;
  name: string;
  description: string;
  /**
   * 派生自哪个 reveal 内置主题。
   * ⚠️ 只用**无内嵌字体**的轻量主题（simple/serif/sky/night/dracula，各 8KB）：
   * 实测 `black` / `black-contrast` 各内嵌 base64 字体、单份 564KB，内联进 srcdoc 等于每次放映多背半兆。
   */
  baseTheme: string;
  design: TemplateDesign;
  config?: DeckConfig;
}

export const BUILTIN_TEMPLATES: BuiltinTemplateDef[] = [
  {
    id: 'builtin-platform-blue',
    name: '平台蓝',
    description: '与平台主色一致的浅色模板，适合大多数课程',
    baseTheme: 'simple',
    design: {
      primary: '#1677ff',
      background: '#ffffff',
      text: '#1f2328',
      accent: '#0958d9',
      fontFamily: "'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      headingFontFamily: "'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      radius: 8,
      density: 'cozy',
      fontScale: 'standard',
      cardStyle: 'soft',
    },
    config: { transition: 'slide', slideNumber: 'c/t', progress: true },
  },
  {
    id: 'builtin-nju-purple',
    name: '南大紫',
    description: '南大配色，庄重适合正式场合',
    baseTheme: 'sky',
    design: {
      primary: '#6a3d9a',
      background: '#fbfaff',
      text: '#221a2e',
      accent: '#8b5cf6',
      fontFamily: "'Songti SC', 'STSong', 'SimSun', serif",
      headingFontFamily: "'Songti SC', 'STSong', 'SimSun', serif",
      radius: 6,
      density: 'cozy',
      fontScale: 'standard',
      cardStyle: 'soft',
    },
    config: { transition: 'fade', slideNumber: 'c/t', progress: true },
  },
  {
    id: 'builtin-academic-white',
    name: '学术白',
    description: '高可读性衬线体，适合理论讲解与公式较多的章节',
    baseTheme: 'serif',
    design: {
      primary: '#0f172a',
      background: '#ffffff',
      text: '#111827',
      accent: '#1d4ed8',
      fontFamily: "'Georgia', 'Songti SC', 'STSong', serif",
      headingFontFamily: "'Georgia', 'Songti SC', 'STSong', serif",
      radius: 4,
      density: 'loose',
      fontScale: 'standard',
      cardStyle: 'none',
    },
    config: { transition: 'fade', slideNumber: 'c/t', progress: false },
  },
  {
    id: 'builtin-dark-contrast',
    name: '深色高对比',
    description: '深色主题，投影仪环境或代码讲解用',
    baseTheme: 'dracula',
    design: {
      primary: '#7ee787',
      background: '#0d1117',
      text: '#e6edf3',
      accent: '#58a6ff',
      fontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', 'Microsoft YaHei', monospace",
      headingFontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', 'Microsoft YaHei', monospace",
      radius: 8,
      density: 'cozy',
      fontScale: 'standard',
      cardStyle: 'outline',
    },
    config: { transition: 'none', slideNumber: 'c/t', progress: true },
  },
  {
    id: 'builtin-minimal-mono',
    name: '极简黑白',
    description: '无彩色，只靠层次与留白，适合论文式汇报',
    baseTheme: 'night',
    design: {
      primary: '#111111',
      background: '#ffffff',
      text: '#333333',
      accent: '#666666',
      fontFamily: "'Helvetica Neue', Helvetica, 'PingFang SC', sans-serif",
      headingFontFamily: "'Helvetica Neue', Helvetica, 'PingFang SC', sans-serif",
      radius: 0,
      density: 'compact',
      fontScale: 'compact',
      cardStyle: 'none',
    },
    config: { transition: 'none', slideNumber: true, progress: false },
  },
];

export const DEFAULT_TEMPLATE_ID = 'builtin-platform-blue';

/**
 * 允许作为主题基座的 reveal 内置主题白名单。
 * ⚠️ **刻意不含 `black` / `black-contrast`**：实测这两份各内嵌 base64 字体、单份 564KB，
 * 内联进 srcdoc 会让每次放映多背半兆；其余主题都是 8KB 量级。
 */
export const ALLOWED_BASE_THEMES = [
  'simple',
  'serif',
  'sky',
  'night',
  'dracula',
  'moon',
  'league',
  'beige',
  'solarized',
  'blood',
] as const;

export function isAllowedBaseTheme(theme: unknown): boolean {
  return (
    typeof theme === 'string' &&
    (ALLOWED_BASE_THEMES as readonly string[]).includes(theme)
  );
}

export function findBuiltinTemplate(id: string | null | undefined): BuiltinTemplateDef | undefined {
  if (!id) return undefined;
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

export function isBuiltinTemplateId(id: string | null | undefined): boolean {
  return !!findBuiltinTemplate(id);
}

// ---------------------------------------------------------------- 校验（窄字符集）

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.,\s%]+\)|hsla?\(\s*[\d.,\s%]+\)|[a-z]{3,20})$/;
/** 字体栈：只允许字母数字、空格、逗号、引号、连字符与中文（中文字体名如“思源黑体”） */
const FONT_RE = /^[A-Za-z0-9 ,'"\-\u4e00-\u9fa5]{1,200}$/;
/** 页脚文案：禁掉一切可能与 CSS/HTML 交互的字符 */
const FOOTER_RE = /^[^<>{};\\"']{1,80}$/;
const DENSITIES = ['compact', 'cozy', 'loose'] as const;
const FONT_SCALES = ['compact', 'standard', 'large'] as const;
const CARD_STYLES = ['none', 'soft', 'outline'] as const;

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

function pickColor(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !COLOR_RE.test(value.trim())) {
    throw new TemplateValidationError(`${field} 不是合法颜色值`);
  }
  return value.trim();
}

function pickFont(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !FONT_RE.test(value)) {
    throw new TemplateValidationError(`${field} 含不允许的字符（只允许字母数字、空格、逗号、引号、连字符与中文）`);
  }
  return value.trim();
}

/** 校验并收敛为可安全落入 CSS 的设计参数 */
export function validateTemplateDesign(raw: unknown): TemplateDesign {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TemplateValidationError('design 必须是对象');
  }
  const input = raw as Record<string, unknown>;
  const design: TemplateDesign = {};

  const primary = pickColor(input.primary, 'primary');
  if (primary) design.primary = primary;
  const background = pickColor(input.background, 'background');
  if (background) design.background = background;
  const text = pickColor(input.text, 'text');
  if (text) design.text = text;
  const accent = pickColor(input.accent, 'accent');
  if (accent) design.accent = accent;

  const fontFamily = pickFont(input.fontFamily, 'fontFamily');
  if (fontFamily) design.fontFamily = fontFamily;
  const headingFontFamily = pickFont(input.headingFontFamily, 'headingFontFamily');
  if (headingFontFamily) design.headingFontFamily = headingFontFamily;

  if (input.footerText !== undefined && input.footerText !== null && input.footerText !== '') {
    if (typeof input.footerText !== 'string' || !FOOTER_RE.test(input.footerText)) {
      throw new TemplateValidationError('footerText 含不允许的字符或过长');
    }
    design.footerText = input.footerText;
  }

  if (input.logoFileId !== undefined) {
    if (input.logoFileId === null || input.logoFileId === '') {
      design.logoFileId = null;
    } else if (
      typeof input.logoFileId !== 'string' ||
      !/^[0-9a-fA-F-]{36}$/.test(input.logoFileId)
    ) {
      throw new TemplateValidationError('logoFileId 必须是平台文件 id');
    } else {
      design.logoFileId = input.logoFileId;
    }
  }

  if (input.radius !== undefined && input.radius !== null) {
    const radius = Number(input.radius);
    if (!Number.isFinite(radius) || radius < 0 || radius > 48) {
      throw new TemplateValidationError('radius 必须在 0–48 之间');
    }
    design.radius = Math.round(radius);
  }

  if (input.density !== undefined && input.density !== null) {
    if (!DENSITIES.includes(input.density as (typeof DENSITIES)[number])) {
      throw new TemplateValidationError(`density 只能是 ${DENSITIES.join(' / ')}`);
    }
    design.density = input.density as TemplateDesign['density'];
  }

  if (input.fontScale !== undefined && input.fontScale !== null) {
    if (!FONT_SCALES.includes(input.fontScale as (typeof FONT_SCALES)[number])) {
      throw new TemplateValidationError(`fontScale 只能是 ${FONT_SCALES.join(' / ')}`);
    }
    design.fontScale = input.fontScale as TemplateDesign['fontScale'];
  }

  if (input.cardStyle !== undefined && input.cardStyle !== null) {
    if (!CARD_STYLES.includes(input.cardStyle as (typeof CARD_STYLES)[number])) {
      throw new TemplateValidationError(`cardStyle 只能是 ${CARD_STYLES.join(' / ')}`);
    }
    design.cardStyle = input.cardStyle as TemplateDesign['cardStyle'];
  }

  return design;
}

// ---------------------------------------------------------------- 设计参数 → CSS

const DENSITY_GAP: Record<NonNullable<TemplateDesign['density']>, string> = {
  compact: '0.35em',
  cozy: '0.55em',
  loose: '0.8em',
};

/** 字号阶梯 → reveal 基准字号（reveal.css 默认 40px，主题可能改写；模板规则在最后加载，同级优先级覆盖主题） */
const FONT_SCALE_PX: Record<NonNullable<TemplateDesign['fontScale']>, string> = {
  compact: '32px',
  standard: '38px',
  large: '44px',
};

/**
 * 把设计参数编译成一小段 CSS（变量 + 少量规则）。
 * 返回的字符串由前端直接塞进 srcdoc 的 `<style>`，所以**每个值都已经过窄字符集校验**。
 */
export function designToCss(design: TemplateDesign): string {
  const vars: string[] = [];
  if (design.primary) vars.push(`  --deck-primary: ${design.primary};`);
  if (design.background) vars.push(`  --deck-background: ${design.background};`);
  if (design.text) vars.push(`  --deck-text: ${design.text};`);
  if (design.accent) vars.push(`  --deck-accent: ${design.accent};`);
  if (design.fontFamily) vars.push(`  --deck-font: ${design.fontFamily};`);
  if (design.headingFontFamily) vars.push(`  --deck-font-heading: ${design.headingFontFamily};`);
  if (design.radius !== undefined) vars.push(`  --deck-radius: ${design.radius}px;`);
  if (design.density) vars.push(`  --deck-gap: ${DENSITY_GAP[design.density]};`);

  const rules: string[] = [];
  rules.push('.reveal { font-family: var(--deck-font, inherit); color: var(--deck-text, inherit); }');
  if (design.fontScale) rules.push(`.reveal { font-size: ${FONT_SCALE_PX[design.fontScale]}; }`);
  if (design.background) rules.push('.reveal { background: var(--deck-background); }');
  rules.push(
    '.reveal h1, .reveal h2, .reveal h3, .reveal h4 { font-family: var(--deck-font-heading, inherit); color: var(--deck-primary, inherit); text-transform: none; }',
  );
  rules.push('.reveal .slides section { border-radius: var(--deck-radius, 0); }');
  rules.push('.reveal ul { margin-left: 1.1em; }');
  rules.push('.reveal li { margin-bottom: var(--deck-gap, 0.55em); }');
  rules.push('.reveal .deck-accent { color: var(--deck-accent, inherit); }');
  rules.push('.reveal .deck-note { font-size: 0.6em; opacity: 0.7; margin-top: 0.8em; }');
  rules.push(
    '.reveal .deck-footer { position: absolute; left: 24px; right: 24px; bottom: 14px; display: flex; align-items: center; justify-content: space-between; font-size: 0.42em; opacity: 0.65; }',
  );
  rules.push('.reveal .deck-footer img { height: 1.6em; width: auto; }');

  // 卡片化（要点清单 / 对比栏共用）：soft = 浅色底卡，outline = 描边卡；none 不加规则
  if (design.cardStyle === 'soft' || design.cardStyle === 'outline') {
    const paint =
      design.cardStyle === 'soft'
        ? 'background: color-mix(in srgb, var(--deck-primary, #1677ff) 7%, transparent);'
        : 'background: transparent; border: 1px solid color-mix(in srgb, var(--deck-primary, #1677ff) 28%, transparent);';
    rules.push(
      `.reveal .deck-bullets li, .reveal .deck-compare-col li { ${paint} border-radius: var(--deck-radius, 8px); padding: 0.3em 0.65em; margin-bottom: calc(var(--deck-gap, 0.55em) * 0.75); list-style: none; border-left: 3px solid var(--deck-accent, transparent); }`,
    );
  }

  return [`:root {\n${vars.join('\n')}\n}`, '', ...rules, ''].join('\n');
}
