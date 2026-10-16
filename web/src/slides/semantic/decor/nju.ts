/**
 * 主题装饰层：「南大风」（`builtin-nju`）专属的构件 —— 眉首／眉尾色带、封面与分节页的
 * 钟楼辅助背景、页脚徽记。
 *
 * 为什么单独一层（而不是塞进 `layouts.css`）：
 *   · `layouts.css` 的纪律是**版式与主题解耦**（零硬编码颜色、换主题不动一行），装饰恰恰是
 *     "某个主题专有的图形"，塞进去就破了这条纪律（断言会拦）；
 *   · 装饰只在该主题编译出的 CSS 里存在 —— 换主题即消失，DOM 一个字节都不变
 *     （断言「换主题后 DOM 完全不变」照样过）。
 *
 * 三条实现约束（都是踩过坑的地方）：
 *   1) 注入顺序是 `base.css → themeCss → layouts.css`，主题 CSS **在版式之前**，
 *      所以装饰里凡要盖住 layouts.css 既有规则的，一律加 `.deck` 前缀提权
 *      （`.deck .ly .kicker` 是 0,3,0 > `.ly .kicker` 的 0,2,0）；
 *   2) 颜色一律走 token（`--nju-*` 在主主题里定义），换主色时装饰跟着变；
 *   3) **不能给承载色带的伪元素整体设 opacity** —— 色带会跟着变淡。所以：
 *      · 眉首／眉尾挂在 `.slide` 的 `::before` / `::after` 上（两条全宽带，互不干扰）；
 *      · 钟楼水印走 `.slide` 自身的 `background-image`（第三层），既贴得住页底，
 *        又不占用伪元素；照片的"淡"由第一层遮罩（`--nju-hero-veil`）实现。
 */

/** 眉首／眉尾／页脚／标题等构件：与主题 token 解耦的纯结构规则（颜色全部来自 var） */
export function njuDecorCss(heroUri: string): string {
  return `
/* ============================ 南大风：装饰层 ============================ */
/* 画布底色：不是纯白 —— 南大紫的极淡层次 + 一点暖调，右上/左下各一处收束的晕染 */
.deck {
  background-color: var(--bg);
  background-image:
    radial-gradient(1180px 680px at 94% -12%, var(--nju-halo-a), transparent 68%),
    radial-gradient(960px 600px at -10% 110%, var(--nju-halo-b), transparent 66%),
    linear-gradient(158deg, var(--nju-paper-1) 0%, var(--nju-paper-2) 54%, var(--nju-paper-3) 100%);
}

/* ---------- 眉首：顶部紫→金细带（每一页都有，封面也不例外） ---------- */
.deck .slide::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--nju-head-h, 14px);
  background-image: var(--nju-head-band);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  z-index: 5;
  pointer-events: none;
}

/* ---------- 眉尾：底部色带（上沿一条金线，带内留给页脚文字） ---------- */
.deck .slide::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--nju-foot-band);
  background-repeat: no-repeat;
  background-position: left bottom;
  background-size: 100% var(--nju-foot-h, 76px);
  z-index: 4;
  pointer-events: none;
}

/* ---------- 内容页右上角：同心灵感弧（封面/分节页已有钟楼，用下面的规则换掉） ----------
 * 走 .slide 的 background-image（背景层）而不是伪元素：装饰永远在内容之下，
 * 不会压到卡片上的字（实测把弧挂在 ::after 上会盖住右上角的卡片）。 */
.deck .slide {
  background-image: var(--nju-corner);
  background-repeat: no-repeat;
  background-position: right 0 top 0;
  background-size: 660px 660px;
}

/* ---------- 封面 / 分节页：钟楼辅助背景 ----------
 * 走 .slide 自身的 background（不是伪元素）—— 固定画布下这样能精确贴住页底出血，
 * 且停在眉尾色带的上沿（不进带内，免得压住页码那行字）。
 * 第一层是遮罩（照片用它压淡）；剪影自带淡色，主题里该层为 none。 */
.deck .slide[data-intent="cover"],
.deck .slide[data-intent="section"] {
  background-image: var(--nju-hero-veil, none), url("${heroUri}");
  background-repeat: no-repeat;
  background-position: right -72px bottom 6px, right -72px bottom 6px;
  background-size: 100% 100%, 560px auto;
}

/* ---------- 页脚：徽记 + 字距 + 页码 ---------- */
.deck .deck-footer {
  font-size: calc(15px * var(--fs-boost, 1));
  letter-spacing: 0.04em;
  color: var(--nju-foot-ink);
}
.deck .deck-footer > span:first-child {
  display: inline-flex;
  align-items: center;
}
.deck .deck-footer > span:first-child::before {
  content: '';
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 11px;
  border-radius: 2px;
  background: var(--nju-mark);
  transform: rotate(45deg);
}
.deck .deck-footer .slide-number {
  color: var(--nju-foot-ink);
  font-weight: 600;
  letter-spacing: 0.08em;
}

/* ---------- 页头小标（kicker）：左侧紫金短条 ---------- */
.deck .ly .kicker {
  display: flex;
  align-items: center;
  gap: 12px;
  letter-spacing: 0.2em;
  color: var(--nju-kicker);
}
.deck .ly .kicker::before {
  content: '';
  flex: none;
  width: 40px;
  height: 5px;
  border-radius: 3px;
  background: var(--nju-mark);
}
.deck .ly h2.ly-title {
  color: var(--nju-ink-strong);
}
.deck .ly strong {
  color: var(--nju-ink-accent);
}

/* ---------- 封面 ---------- */
.deck .ly-cover .ly-rule {
  width: 178px;
  height: 8px;
  border-radius: 4px;
  background: var(--nju-mark);
}
.deck .ly-cover .ly-cover-kicker {
  color: var(--nju-kicker);
  letter-spacing: 0.3em;
}
.deck .ly-cover h1 {
  color: var(--nju-ink-strong);
}
.deck .ly-cover .ly-cover-sub {
  color: var(--nju-body);
}
.deck .ly-pills .pill {
  background: var(--nju-pill-bg);
  border-color: var(--nju-pill-border);
  color: var(--nju-body);
}

/* ---------- 分节页：大编号走紫→金渐变文字 ---------- */
.deck .ly-section .ly-section-num {
  background: var(--nju-num-grad);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  opacity: 1;
}
.deck .ly-section h1 {
  color: var(--nju-ink-strong);
}
.deck .ly-section .ly-teaser span {
  background: var(--nju-pill-bg);
  border-color: var(--nju-pill-border);
  color: var(--nju-body);
}

/* ---------- 卡片与要点卡：淡紫描边，收住"素净"里的灰 ---------- */
.deck .ly-ev,
.deck .ly-card,
.deck .ly-toc-item,
.deck .ly-step,
.deck .ly-metric,
.deck .ly-sum-item,
.deck .ly-tl-card,
.deck .ly-cell,
.deck .ly-flow-node,
.deck .ly-rel-n {
  border-color: var(--nju-card-border);
}
.deck .ly-toc-num,
.deck .ly-step-n,
.deck .ly-metric b {
  color: var(--nju-ink-accent);
}
.deck thead th {
  background: var(--nju-thead-bg);
}
`;
}
