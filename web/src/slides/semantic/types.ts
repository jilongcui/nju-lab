/**
 * 语义页模型（Semantic Deck Model）—— 幻灯片内容抽象层。
 *
 * 设计动机见 `docs/DESIGN-2026-10-10-slides-semantic-html.md`：
 * 旧的模型是**版式导向**的（`layout + bullets/stats/compare`），模型得同时决定
 * "讲什么"和"用哪个版式"，两头都平庸，而且版式被钉死成 16 种枚举。
 * 新模型是**语义导向**的：模型只表达「这一页要完成什么（intent）」和
 * 「由哪些内容块构成（blocks）」，**版式由渲染层映射**。
 *
 * 三条收益：
 *   1) 内容与视觉解耦 —— 换主题/换设计系统不需要重新生成；
 *   2) 图示靠**结构数据**而非模型手写图形（`relation/sequence/timeline` 只给数据，
 *      图形由我们自己的组件画），既是安全边界也是质量保证；
 *   3) 固定 1920×1080 画布下，块级预算（条数/字数）是**可计算**的（见 slice 层校验）。
 */

/** 这一页要完成的教学动作 —— 决定版式选型与阅读节奏 */
export type PageIntent =
  | 'cover' // 封面
  | 'toc' // 本章脉络
  | 'section' // 分节页
  | 'claim' // 讲清一件事：主张 + 支撑证据
  | 'contrast' // 两件事对照
  | 'pillars' // 并列几件事（2–4）
  | 'metric' // 关键数字（1–4 个）
  | 'sequence' // 有先后的步骤
  | 'flow' // 数据/算子流动（线性管线）
  | 'arch' // 分层结构
  | 'relation' // 概念之间的关系（中心 + 卫星）
  | 'timeline' // 时间/演化
  | 'table' // 数据表（严格对齐的数值）
  | 'data' // 数据图（柱状 / 折线 / 环形）
  | 'example' // 代码/命令示例
  | 'quote' // 点睛引用
  | 'image' // 以图为主
  | 'summary'; // 小结/收尾

export interface MetricItem {
  /** 数字本体（字符串，保留原始精度与单位，如 "0.2761" / "8d16d6b80dda"） */
  value: string;
  /** 单位后缀（如 "%"），可为空 */
  unit?: string;
  /** 这个数字是什么 */
  label: string;
  /** 补充说明（口径、case 名） */
  detail?: string;
  /** 语义色：上升/正确用 up，下降/异常用 down，中性不写 */
  tone?: 'up' | 'down' | 'neutral';
}

export interface SequenceItem {
  title: string;
  desc?: string;
  /** 步骤角标（耗时、产物名等，可为空） */
  tag?: string;
}

export interface FlowNode {
  title: string;
  desc?: string;
  /** 高亮节点（本页主角） */
  highlight?: boolean;
}

export interface ArchLevel {
  /** 层名（左侧标签） */
  name: string;
  cells: { title: string; desc?: string }[];
  highlight?: boolean;
}

export interface RelationNode {
  label: string;
  desc?: string;
  /** 中心节点（一个），其余为卫星 */
  center?: boolean;
}

export interface TimelinePoint {
  at: string;
  title: string;
  desc?: string;
  highlight?: boolean;
}

export interface CompareColumn {
  title: string;
  items: string[];
  /** 语义色：up=好的/推荐的一侧，down=有问题的一侧，accent=并列强调（无好坏），neutral=中性 */
  tone?: 'up' | 'down' | 'accent' | 'neutral';
}

export type Block =
  | { kind: 'claim'; text: string }
  | { kind: 'evidence'; items: string[] }
  | { kind: 'metric'; items: MetricItem[] }
  | { kind: 'sequence'; items: SequenceItem[] }
  | { kind: 'flow'; nodes: FlowNode[] }
  | { kind: 'arch'; levels: ArchLevel[] }
  | { kind: 'relation'; nodes: RelationNode[] }
  | { kind: 'timeline'; points: TimelinePoint[] }
  | { kind: 'compare'; left: CompareColumn; right: CompareColumn }
  | { kind: 'table'; head: string[]; rows: string[][]; align?: ('l' | 'r')[] }
  | {
      kind: 'chart';
      chart: 'bar' | 'line' | 'donut';
      labels: string[];
      series: { name?: string; values: number[] }[];
      /** 数值单位（轴标签用，如 "%" / "s"） */
      unit?: string;
      /** 高亮第 i 个数据点（讲这一根柱/这一个点） */
      highlight?: number;
    }
  | { kind: 'formula'; tex: string; caption?: string }
  | { kind: 'code'; lang: string; content: string; caption?: string }
  | { kind: 'quote'; text: string; cite?: string }
  | {
      kind: 'image';
      fileId: string;
      caption?: string;
      /** inline=居中单图 / hero=图文并排 / full=大图不裁切 / grid=多图网格 */
      role?: 'hero' | 'inline' | 'full' | 'grid';
      /** grid：多图（1–4 张） */
      items?: { fileId: string; caption?: string }[];
    }
  | { kind: 'note'; text: string };

export interface Page {
  intent: PageIntent;
  /** 眉题（课程名 / 分节名 / 「第 N 节」） */
  kicker?: string;
  title?: string;
  subtitle?: string;
  /** 导语（一句话交待这一页要讲什么，≤60 字） */
  lede?: string;
  /** 分节页的大编号 */
  number?: string;
  blocks: Block[];
  /** 整页背景（图片铺满 + 压暗遮罩）；封面/分节页常用 */
  background?: { fileId: string; dim?: number; blur?: boolean };
  /** 讲者备注：只进 <div class="notes">，绝不渲染给观众 */
  notes?: string;
}

/** 一份 deck 的元信息（封面/页脚用） */
export interface DeckMeta {
  course: string;
  chapter: string;
  footer?: string;
  /** 页脚右侧文案（默认章节名） */
  logoText?: string;
}
