/**
 * 主题层：CSS token（设计令牌）驱动，与版式/内容完全解耦。
 *
 * 令牌名沿用 vendored 设计系统 `web/src/slides/vendor/html-ppt/base.css` 的约定
 * （`--bg/--surface/--text-1..3/--accent/--accent-ink/--radius/--shadow/--font-*`），
 * 因此**vendor 主题文件可以直接挂上来用**（MIT，见 vendor/html-ppt/NOTICE.md）。
 *
 * 两条硬规则（来自设计系统本身，也是评审口径）：
 *   1) 版式 CSS **禁止硬编码颜色**，一律用 var(--…)；
 *   2) 画在 --accent 上的文字必须用 --accent-ink（各主题的 accent 从白到黑都有）。
 *
 * 字体：**不引用任何 CDN**（沙箱 iframe + 内网/离线场景都不适合），
 * 使用系统中英字体栈，按平台历史模板的字体取向分配 sans/serif/mono。
 */
import academicPaper from '../vendor/html-ppt/themes/academic-paper.css?raw';
import swissGrid from '../vendor/html-ppt/themes/swiss-grid.css?raw';
import editorialSerif from '../vendor/html-ppt/themes/editorial-serif.css?raw';
import bauhaus from '../vendor/html-ppt/themes/bauhaus.css?raw';

export interface DeckTheme {
  id: string;
  name: string;
  description: string;
  /** 设计取向：决定默认标题字号/间距节奏 */
  mood: 'clean' | 'academic' | 'editorial' | 'bold' | 'dark';
  /** vendored 主题 CSS（自带 token 覆盖）；不写则只用下面的 tokens */
  vendorCss?: string;
  tokens: Record<string, string>;
}

const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'HarmonyOS Sans SC', " +
  "'Source Han Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";
const FONT_SERIF =
  "'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', 'SimSun', Georgia, serif";
const FONT_MONO =
  "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, 'Noto Sans Mono CJK SC', monospace";

/** 系统字体栈：每套主题都强制覆盖，避免 vendor 主题把字体指到 Google Fonts 上 */
const FONT_TOKENS: Record<string, string> = {
  '--font-sans': FONT_SANS,
  '--font-serif': FONT_SERIF,
  '--font-mono': FONT_MONO,
  '--font-display': 'var(--font-sans)',
};

/**
 * 内置主题。前 5 套**沿用平台历史模板的 id 与主色**（教师侧概念不断裂），
 * 后 3 套来自 vetendored 设计系统（MIT）。
 */
export const DECK_THEMES: DeckTheme[] = [
  {
    id: 'builtin-platform-blue',
    name: '平台蓝',
    description: '与平台主色一致的浅色主题，适合大多数课程',
    mood: 'clean',
    tokens: {
      '--bg': '#ffffff',
      '--bg-soft': '#f4f7fd',
      '--surface': '#ffffff',
      '--surface-2': '#eef3fb',
      '--border': 'rgba(16,42,84,.10)',
      '--border-strong': 'rgba(16,42,84,.22)',
      '--text-1': '#16233a',
      '--text-2': '#4a5a75',
      '--text-3': '#8593ab',
      '--accent': '#1677ff',
      '--accent-ink': '#ffffff',
      '--accent-2': '#0958d9',
      '--accent-3': '#36cfc9',
      '--accent-soft': 'color-mix(in srgb, #1677ff 10%, transparent)',
      '--good': '#16a34a',
      '--warn': '#d48806',
      '--bad': '#cf1322',
      '--grad': 'linear-gradient(120deg,#1677ff,#0958d9 60%,#36cfc9)',
      '--grad-soft': 'linear-gradient(120deg,#eaf2ff,#e6fbfa)',
      '--radius': '16px',
      '--radius-sm': '10px',
      '--radius-lg': '24px',
      '--shadow': '0 10px 28px rgba(16,42,84,.07), 0 2px 6px rgba(16,42,84,.04)',
      '--shadow-lg': '0 22px 54px rgba(16,42,84,.12)',
    },
  },
  {
    id: 'builtin-nju-purple',
    name: '南大紫',
    description: '南大配色，庄重适合正式场合',
    mood: 'academic',
    tokens: {
      '--bg': '#fbfaff',
      '--bg-soft': '#f4f0fb',
      '--surface': '#ffffff',
      '--surface-2': '#f2ecfa',
      '--border': 'rgba(52,26,90,.12)',
      '--border-strong': 'rgba(52,26,90,.26)',
      '--text-1': '#221a2e',
      '--text-2': '#544a68',
      '--text-3': '#8b82a0',
      '--accent': '#6a3d9a',
      '--accent-ink': '#ffffff',
      '--accent-2': '#8b5cf6',
      '--accent-3': '#c084fc',
      '--accent-soft': 'color-mix(in srgb, #6a3d9a 10%, transparent)',
      '--good': '#15803d',
      '--warn': '#b45309',
      '--bad': '#b91c1c',
      '--grad': 'linear-gradient(120deg,#6a3d9a,#8b5cf6 60%,#c084fc)',
      '--grad-soft': 'linear-gradient(120deg,#f3ecff,#faf0ff)',
      '--radius': '12px',
      '--radius-sm': '8px',
      '--radius-lg': '20px',
      '--shadow': '0 10px 28px rgba(52,26,90,.08), 0 2px 6px rgba(52,26,90,.04)',
      '--shadow-lg': '0 22px 54px rgba(52,26,90,.13)',
    },
  },
  {
    id: 'builtin-dark-contrast',
    name: '深色高对比',
    description: '深色主题，投影仪环境或代码讲解用',
    mood: 'dark',
    tokens: {
      '--bg': '#0d1117',
      '--bg-soft': '#131a23',
      '--surface': '#161d27',
      '--surface-2': '#1c2531',
      '--border': 'rgba(230,237,243,.14)',
      '--border-strong': 'rgba(230,237,243,.3)',
      '--text-1': '#e6edf3',
      '--text-2': '#b3bfcd',
      '--text-3': '#7d8b9c',
      '--accent': '#58a6ff',
      '--accent-ink': '#08131f',
      '--accent-2': '#7ee787',
      '--accent-3': '#d2a8ff',
      '--accent-soft': 'color-mix(in srgb, #58a6ff 16%, transparent)',
      '--good': '#7ee787',
      '--warn': '#e3b341',
      '--bad': '#ff7b72',
      '--grad': 'linear-gradient(120deg,#58a6ff,#7ee787 60%,#d2a8ff)',
      '--grad-soft': 'linear-gradient(120deg,#12233a,#152b24)',
      '--radius': '12px',
      '--radius-sm': '8px',
      '--radius-lg': '18px',
      '--shadow': '0 10px 28px rgba(0,0,0,.45)',
      '--shadow-lg': '0 22px 54px rgba(0,0,0,.55)',
    },
  },
  {
    id: 'builtin-minimal-mono',
    name: '极简黑白',
    description: '无彩色，只靠层次与留白，适合论文式汇报',
    mood: 'editorial',
    tokens: {
      '--bg': '#ffffff',
      '--bg-soft': '#f6f6f6',
      '--surface': '#ffffff',
      '--surface-2': '#f2f2f2',
      '--border': 'rgba(0,0,0,.14)',
      '--border-strong': 'rgba(0,0,0,.34)',
      '--text-1': '#111111',
      '--text-2': '#444444',
      '--text-3': '#8a8a8a',
      '--accent': '#111111',
      '--accent-ink': '#ffffff',
      '--accent-2': '#555555',
      '--accent-3': '#999999',
      '--accent-soft': 'rgba(0,0,0,.06)',
      '--good': '#1a1a1a',
      '--warn': '#666666',
      '--bad': '#333333',
      '--grad': 'linear-gradient(120deg,#111,#555)',
      '--grad-soft': 'linear-gradient(120deg,#f2f2f2,#fafafa)',
      '--radius': '0px',
      '--radius-sm': '0px',
      '--radius-lg': '0px',
      '--shadow': 'none',
      '--shadow-lg': '0 2px 10px rgba(0,0,0,.1)',
    },
  },
  {
    id: 'builtin-academic-white',
    name: '学术白',
    description: '高可读性衬线体，适合理论讲解与公式较多的章节',
    mood: 'academic',
    vendorCss: academicPaper,
    tokens: {
      '--font-sans': FONT_SERIF,
      '--font-display': FONT_SERIF,
      '--radius': '2px',
      '--radius-sm': '2px',
      '--radius-lg': '4px',
      '--shadow': 'none',
    },
  },
  {
    id: 'vendor-swiss-grid',
    name: '瑞士网格',
    description: '国际主义网格排版，理性克制（vendored: html-ppt-skill, MIT）',
    mood: 'clean',
    vendorCss: swissGrid,
    tokens: {},
  },
  {
    id: 'vendor-editorial-serif',
    name: '杂志衬线',
    description: '杂志式排版，适合人文与综述类内容（vendored: MIT）',
    mood: 'editorial',
    vendorCss: editorialSerif,
    tokens: {},
  },
  {
    id: 'vendor-bauhaus',
    name: '包豪斯',
    description: '高饱和几何风格，适合一次性的公开分享（vendored: MIT）',
    mood: 'bold',
    vendorCss: bauhaus,
    tokens: {},
  },
];

export const DEFAULT_THEME_ID = 'builtin-platform-blue';

export function findTheme(id: string | undefined | null): DeckTheme {
  return DECK_THEMES.find((theme) => theme.id === id) ?? DECK_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

/**
 * 编译主题 CSS：**字体栈 → vendor token → 本主题 token**（后者覆盖前者）。
 * 字体放在最前面，确保 vendor 主题里的 Google Fonts 指向被系统字体栈顶掉。
 */
export function themeCss(theme: DeckTheme): string {
  const fromTokens = (tokens: Record<string, string>) =>
    Object.entries(tokens)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n');
  const parts = [
    `:root {\n${fromTokens(FONT_TOKENS)}\n}`,
    theme.vendorCss?.trim() ?? '',
    Object.keys(theme.tokens).length ? `:root {\n${fromTokens(theme.tokens)}\n}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}
