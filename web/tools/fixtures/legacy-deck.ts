/**
 * 旧模型（`SlideJson`）测试集：**覆盖全部 16 种旧版式**，用于验证
 * `semantic/legacy.ts` 适配器（既要把观感换新，又不许丢内容）。
 *
 * 内容取自第 16 章《记忆系统》实验的真实口径（`server/fixtures/memory-strategies/README.md`）：
 * 记忆四操作、三种上下文策略的 recall@k、before/after 对照。
 */
import type { SlideJson } from '../../src/types';

export const LEGACY_DECK_META = {
  course: '分子医学人工智能理论与实验',
  chapter: '第 16 章 · 记忆系统',
};

export const LEGACY_SLIDES: SlideJson[] = [
  {
    id: 'p1',
    layout: 'cover',
    kicker: '分子医学人工智能理论与实验 · 第 16 章',
    title: '记忆系统：把「记住」拆成四种操作',
    subtitle: '写入、检索、更新、遗忘 —— 再用窗口 / 摘要 / 检索三种策略跑一遍对照。',
    bullets: ['四操作', '三策略对照', 'recall@k', 'before / after'],
    notes: '开场：记忆不是"把历史都塞进上下文"，而是四个可以分别实现、分别测量的操作。',
  },
  {
    id: 'p2',
    layout: 'agenda',
    title: '本章脉络',
    bullets: ['记忆为什么不能只靠长上下文', '四种操作的语义与边界', '三种策略的对照实验', 'before / after 的证据链'],
  },
  {
    id: 'p3',
    layout: 'section',
    kicker: 'Section 01',
    title: '记忆的四种操作',
    bullets: ['写入', '检索', '更新', '遗忘'],
  },
  {
    id: 'p4',
    layout: 'bullets',
    title: '为什么长上下文不是记忆',
    bullets: [
      '窗口是**容量**问题，记忆是**取舍**问题',
      '无关历史会稀释当前问题的注意力',
      '旧信息需要被更新，错误信息需要被遗忘',
      '没有取舍机制，窗口再长也只是"什么都塞"',
    ],
    notes: '强调取舍：把什么留下、把什么改写、把什么丢掉，才是记忆系统的本体。',
  },
  {
    id: 'p5',
    layout: 'steps',
    title: '四步落地',
    bullets: ['写入：抽取条目并落库', '检索：按当前问题取回相关条目', '更新：用新事实覆盖旧条目', '遗忘：标记失效并停止命中'],
  },
  {
    id: 'p6',
    layout: 'stat',
    title: '三种策略的 recall@k',
    stats: [
      { value: '0.3', label: '滑动窗口', detail: '只保留最近若干轮' },
      { value: '0.7', label: '摘要记忆', detail: '滚动摘要 + 最近原文' },
      { value: '0.8', label: '检索记忆', detail: '按问题取回相关条目' },
    ],
    notes: '读法：同一批问题，三种策略各取回一次，检索策略的命中率最高。',
  },
  {
    id: 'p7',
    layout: 'compare',
    title: '更新与遗忘，各管一件事',
    compare: {
      leftTitle: '更新（update）',
      rightTitle: '遗忘（forget）',
      left: ['用新事实覆盖旧条目', '旧条目变为 superseded，不再命中', '历史仍可追溯', '只处理处于 active 的条目'],
      right: ['把不再需要的信息标记为失效', '在任何一种策略下都取不到', '与更新共用"停止命中"的语义', '边界：superseded 不会被顺带遗忘'],
    },
  },
  {
    id: 'p8',
    layout: 'two-col',
    title: '窗口 vs 检索：差在哪',
    left: '窗口策略实现最简单，但**只能看到最近**；一旦问题指向更早的事实，它就无能为力。',
    right: '检索策略按当前问题打分取条目，覆盖更全；代价是要维护条目表与检索逻辑，也更依赖写入质量。',
  },
  {
    id: 'p9',
    layout: 'code',
    title: '检索：按问题取回条目',
    code: {
      lang: 'python',
      content: `def retrieve(entries, query, k=3):
    # 只检索仍然 active 的条目
    live = [e for e in entries if e.state == "active"]
    scored = sorted(live, key=lambda e: sim(e.text, query), reverse=True)
    return [e for e in scored[:k] if sim(e.text, query) > 0.2]`,
    },
  },
  {
    id: 'p10',
    layout: 'quote',
    title: '一句话',
    quote: { text: '记忆系统的难点不在存，而在**决定不存什么**。', cite: '本章小结' },
  },
  {
    id: 'p11',
    layout: 'image',
    image: { url: 'file:demo-memory-flow', caption: '记忆四操作的数据流（示意）' },
  },
  {
    id: 'p12',
    layout: 'image-full',
    image: { url: 'file:demo-recall-curve', caption: '三种策略的 recall 对照曲线' },
  },
  {
    id: 'p13',
    layout: 'image-left',
    image: { url: 'file:demo-before-after', caption: 'before / after' },
    bullets: ['同一问题，更新前命中旧条目', '更新后旧条目不再命中', '被遗忘的条目在三种策略里都取不到'],
  },
  {
    id: 'p14',
    layout: 'image-grid',
    title: '三个关键界面',
    images: [
      { url: 'file:demo-ui-1', caption: '条目表' },
      { url: 'file:demo-ui-2', caption: '检索结果' },
      { url: 'file:demo-ui-3', caption: 'before / after' },
    ],
  },
  {
    id: 'p15',
    layout: 'end',
    title: '带走三句话',
    bullets: [
      '记忆 = 写入 / 检索 / 更新 / 遗忘四个可测操作',
      '更新让旧条目停止命中，遗忘让条目在三种策略里都取不到',
      'recall@k 把"记得住吗"变成一个可以对照的数字',
    ],
  },
  {
    id: 'p16',
    layout: 'bullets',
    title: '动手实践',
    bullets: ['用本地条目表实现四操作', '三种策略各跑一遍对照', '交付 before / after 证据', '边界口径写进 README'],
  },
];
