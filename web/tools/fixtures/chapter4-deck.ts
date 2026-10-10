/**
 * 样张 deck：第 4 章《大语言模型原理和实践》—— 手写缩放点积注意力 + 三档消融 + 采样。
 *
 * 用途：语义渲染层的**观感评测素材**（对应设计文档 §6 的 P0 出口判据）。
 * 内容与数字**全部来自真实实验记录**（`server/fixtures/attention-ablation/README.md`
 * 2026-10-10 在复验镜像里的实测），不是编的 —— 正好覆盖"真实数字/对照/流程/代码"四类页面。
 */
import type { Page } from '../../src/slides/semantic/types';

export const META = {
  course: '分子医学人工智能理论与实验',
  chapter: '第 4 章 · 大语言模型原理和实践',
};

export const PAGES: Page[] = [
  {
    intent: 'cover',
    kicker: '分子医学人工智能理论与实验 · 第 4 章',
    title: '把大模型的机制**量出来**',
    subtitle:
      '手写缩放点积注意力，再用三档消融与采样实验，把「为什么要拆 QKV」「√d 与因果掩码各解决什么」从结论变成可测的数字。',
    blocks: [{ kind: 'evidence', items: ['手写 Q/K/V', '√d 缩放', '因果掩码', '锐化系数', '14 条硬性断言'] }],
    notes:
      '开场：这一章我们不训练模型，只把机制拆开量一遍。所有输入都写死，所以你算出来的数字应当和参考实现逐位一致。',
  },
  {
    intent: 'toc',
    kicker: '本章脉络',
    title: '四个问题，一条主线',
    blocks: [
      {
        kind: 'sequence',
        items: [
          { title: '注意力在分配什么', desc: ' Q/K/V 三副眼镜各管什么，为什么要拆开算' },
          { title: '两个看似玄学的部件', desc: '√d 缩放与因果掩码，各自解决什么问题' },
          { title: '用消融把它们量出来', desc: '最大行权重、行熵、看到未来的权重' },
          { title: '概率不等于选中', desc: '锐化系数如何改变分布，采样占比为何贴近 top-1 概率' },
        ],
      },
    ],
    notes: '目录页口播：四个问题依次递进，每个问题都有一条可验证的判据。',
  },
  {
    intent: 'section',
    number: '01',
    kicker: '第一部分',
    title: '注意力在分配什么',
    lede: '一句话：注意力是「按相关性搬运内容」——算像不像的是 Q 与 K，被搬运的是 V。',
    blocks: [{ kind: 'evidence', items: ['Q · 查询', 'K · 键', 'V · 值', '相似度矩阵'] }],
    notes: '分节页稍停一下，给学生时间把 QKV 三个词和"像不像 / 搬什么"对上。',
  },
  {
    intent: 'relation',
    kicker: 'Q · K · V 的分工',
    title: '三副眼镜，各看一件事',
    blocks: [
      {
        kind: 'relation',
        nodes: [
          { label: '注意力输出', desc: '每个位置拿到的新表示 = 其它位置 V 的加权和', center: true },
          { label: 'Q：查询', desc: '我现在想找什么信息' },
          { label: 'K：键', desc: '我能提供什么信息' },
          { label: 'V：值', desc: '我实际搬运的内容' },
        ],
      },
    ],
    notes:
      '强调：Q·Kᵀ 只决定权重（谁该看谁），真正的信息在 V 里。把两者分开算，权重才能被单独观察、单独消融。',
  },
  {
    intent: 'flow',
    kicker: '一次前向的全过程',
    title: '从 token 到输出，五步',
    blocks: [
      {
        kind: 'flow',
        nodes: [
          { title: 'Q·Kᵀ', desc: '相似度打分' },
          { title: '÷ √d', desc: '缩放，压住数值' },
          { title: '因果掩码', desc: '-inf 遮住未来', highlight: true },
          { title: 'softmax', desc: '按行归一化成权重' },
          { title: '× V', desc: '加权求和' },
        ],
      },
      { kind: 'note', text: '高亮的那一步，就是下面第二个实验要单独拆掉的部件。' },
    ],
    notes: '把五步和代码对应起来：每一步在参考实现里都是两三行 numpy。',
  },
  {
    intent: 'claim',
    kicker: '问题一 · 为什么要 ÷ √d',
    title: '不缩放，softmax 会「饱和」',
    blocks: [
      { kind: 'claim', text: '点积的方差**随维度 d 线性增长**，分数一大，softmax 就把权重全压到少数几个位置上。' },
      {
        kind: 'evidence',
        items: [
          '分数尺度失控 → 权重分布过尖，梯度几乎消失',
          '除以 √d 把分数标准差拉回 1~1.5，既不过平也不过尖',
          '这不是"装饰"，去掉它模型仍能跑，但训练会难得多',
          '本实验把它做成消融：去掉缩放，看权重与熵怎么变',
        ],
      },
    ],
    notes: '这一页是本节的核心结论，后面用数字验证。',
  },
  {
    intent: 'contrast',
    kicker: '两个部件，各修一件事',
    title: '别把 √d 和掩码混为一谈',
    blocks: [
      {
        kind: 'compare',
        left: {
          title: '÷ √d —— 管数值',
          tone: 'accent',
          items: ['防止点积随维度放大', '让 softmax 保持可用的平滑度', '去掉后：分布更尖、行熵更低', '不影响"能不能看到未来"'],
        },
        right: {
          title: '因果掩码 —— 管可见性',
          tone: 'accent',
          items: ['把未来位置的分数设为 -inf', 'softmax 后未来权重严格为 0', '去掉后：模型会"偷看未来"', '不影响权重的尖锐程度'],
        },
      },
    ],
    notes: '两个部件正交：一个改数值尺度，一个改可见集合。学生最常混的就是这一点。',
  },
  {
    intent: 'metric',
    kicker: '消融实测 · case01',
    title: '把差别量出来',
    lede: '同一份输入，只改一个部件，看三个统计量怎么动（容差 1e-3）。',
    blocks: [
      {
        kind: 'metric',
        items: [
          { value: '0.2761', label: '最大行权重（完整版）', detail: '31 token · 2 句' },
          { value: '0.4329', label: '去缩放 → 更尖', detail: '+56.8%' },
          { value: '2.2074', label: '行熵（完整版）', detail: '越高越分散' },
          { value: '1.7238', label: '去缩放 → 更集中', detail: '-21.9%' },
        ],
      },
    ],
    notes: '念法：最大行权重从 0.2761 涨到 0.4329，行熵从 2.2074 掉到 1.7238 —— 两个量一起说明"更尖"。',
  },
  {
    intent: 'table',
    kicker: '三档消融对照',
    title: '同一份输入，三种配置',
    blocks: [
      {
        kind: 'table',
        head: ['配置', '最大行权重', '行熵', '未来权重', '结论'],
        align: ['l', 'r', 'r', 'r', 'l'],
        rows: [
          ['完整版（full）', '0.2761', '2.2074', '0.0000', '基准'],
          ['去缩放（no_scale）', '0.4329', '1.7238', '0.0000', '分布更尖'],
          ['去掩码（no_mask）', '0.2103', '3.1066', '0.4725', '偷看未来'],
        ],
      },
      { kind: 'note', text: '去掩码那一行的"未来权重 0.4725"就是"偷看"的量化证据：完整版必须严格为 0。' },
    ],
    notes: '表格比三条要点更能说明"正交"：去缩放只动前两列，去掩码只动后两列。',
  },
  {
    intent: 'data',
    kicker: '采样 · 锐化系数',
    title: '系数越大，分布越尖',
    lede: '同一个位置的 logits，只改锐化系数，200 次采样里 top-1 被选中的占比：',
    blocks: [
      {
        kind: 'chart',
        chart: 'bar',
        labels: ['锐化系数 0.5', '锐化系数 1.0', '锐化系数 2.0'],
        series: [{ name: 'top-1 实测占比', values: [0.745, 0.54, 0.36] }],
        unit: '',
      },
      {
        kind: 'note',
        text: '实测占比贴近 top-1 概率（0.7728 / 0.5489 / 0.3444）—— 采样确实按分布走，只是"这一次"不等于"概率"。',
      },
    ],
    notes: '看图说话：系数从 0.5 到 2.0，top-1 占比从 0.745 掉到 0.360，分布越来越尖。',
  },
  {
    intent: 'sequence',
    kicker: '动手实践 · 六步',
    title: '从 CSV 到 output.json',
    blocks: [
      {
        kind: 'sequence',
        items: [
          { title: '切 token', desc: '按 sent_id 升序切开句子', tag: 'sentences.csv' },
          { title: '取表示', desc: '每个 token 的输入向量', tag: 'embeddings.csv' },
          { title: '算 QKV', desc: '用写死的三组权重投影', tag: 'params.json' },
          { title: '注意力', desc: '缩放 + 掩码 + softmax', tag: '14 断言' },
          { title: '消融', desc: '三档配置各算一遍统计量', tag: '容差 1e-3' },
          { title: '采样', desc: '锐化系数下抽 200 次', tag: 'seeded' },
        ],
      },
    ],
    notes: '六步与题目包的输出字段一一对应，交付前用 manifest 里的断言自查。',
  },
  {
    intent: 'example',
    kicker: '参考实现节选',
    title: '四十行里的核心八行',
    blocks: [
      {
        kind: 'code',
        lang: 'python',
        content: `def scaled_dot_product_attention(Q, K, V, causal=True):
    d = Q.shape[-1]
    scores = Q @ K.T / math.sqrt(d)        # ÷ √d：管数值尺度
    if causal:                             # 因果掩码：管可见性
        mask = np.triu(np.ones_like(scores), k=1).astype(bool)
        weights = np.where(mask, -np.inf, scores)
    weights = softmax(weights, axis=-1)    # 按行归一化
    return weights @ V, weights
`,
        caption: '去掉 math.sqrt(d) 就是 no_scale；去掉 causal 分支就是 no_mask —— 消融不需要改别的代码。',
      },
    ],
    notes: '带学生逐行读：每行对应流程图上的一步，消融就是删掉其中一行。',
  },
  {
    intent: 'formula',
    kicker: '机制 · 一行写完',
    title: '整条链路写成一行',
    blocks: [
      {
        kind: 'formula',
        tex: '\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d}}+M\\right)V',
        caption: 'M 是因果掩码（未来位取 -inf）：÷√d 管数值尺度，M 管可见性。',
      },
      {
        kind: 'note',
        text: '把这一行拆开读：QKᵀ 算像不像，÷√d 压数值，+M 遮未来，softmax 归一，最后乘 V 搬运内容。',
      },
    ],
    notes: '公式页的作用是把前四页的机制合成一句：每个符号都对应一个可消融的部件。',
  },
  {
    intent: 'metric',
    kicker: '问题二 · 概率不等于选中',
    title: '锐化系数如何改变采样',
    lede: '同一组 logits，只改锐化系数，200 次采样里 top-1 被选中的占比：',
    blocks: [
      {
        kind: 'metric',
        items: [
          { value: '0.745', label: '锐化系数 0.5', detail: 'top1_prob 0.7728' },
          { value: '0.540', label: '锐化系数 1.0', detail: 'top1_prob 0.5489' },
          { value: '0.360', label: '锐化系数 2.0', detail: 'top1_prob 0.3444' },
        ],
      },
      { kind: 'note', text: '实测占比贴近 top-1 概率 —— 这正是"分布"与"一次采样"的区别：概率描述长期频率，不等于每次都会选它。' },
    ],
    notes: '可以现场让学生猜下一个被选中的 token，再对照分布，体会"抽样一次 vs 概率"的差别。',
  },
  {
    intent: 'summary',
    kicker: '小结',
    title: '这一章要你带走的三句话',
    blocks: [
      {
        kind: 'evidence',
        items: [
          '**Q·Kᵀ 决定权重，V 提供内容** —— 拆开算，机制才看得见、才拆得动。',
          '**√d 管数值、掩码管可见性** —— 两个正交部件，各用一条方向性判据量出来。',
          '**概率是长期的频率，不是这一次的选择** —— 锐化系数改形状，采样改"这一次"。',
        ],
      },
    ],
    notes: '收尾：把三句话和实验里的三个判据对上，学生就能自己复现一遍。',
  },
];
