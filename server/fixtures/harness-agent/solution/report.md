# 实测档案（教师侧解答样例）

> 这份是**参考实现的实测记录**，随 `solution/` 保留、不下发。学生侧的过程记录模板见
> `skill-template/report.md`（学生只填那里）。

## 1. 自测概况

- 实现：`solution/scripts/harness.py`（六件各一段，纯标准库 + `matplotlib`）
- 运行环境：`nju-lab-verify:0.2.0-rc.2-pkg6`（与平台复验同镜像）
- 自测时间：2026-11-11

## 2. 各 case 的结果

| case | 轮数 / 总步数 | 工具（executed / rejected） | 记忆（active / superseded / forgotten） | 是否达标 |
|---|---|---|---|---|
| case01 | 5 / 23 | 4 / 4 | 1 / 1 / 0 | 是 |
| case02 | 3 / 12 | 5 / 2 | 0 / 0 / 1 | 是 |

## 3. 对照做法（偷懒解）

- 偷懒做法一：不实现循环，把每轮 `steps` 当结论写进 `answers` —— `trace` 空、`terminated` 无从给出，
  断言"循环真的发生了""终止条件正确"直接 fail；
- 偷懒做法二：检索只用 TF 余弦、不做长度归一 —— `case02` 的 `bm25_top3[0]` 会变成 `KB-03`/`KB-02`，
  与 expected 不符（`top3_diff_turns` 也对不上）；
- 偷懒做法三：把 `escalate_value` 一律执行成功 —— `not_out_of_range` 那条消失，业务校验断言 fail。

## 4. 踩坑记录

1. 一开始把 `max_steps` 当成"总步数上限"，于是 case02 三轮全被记成 `max_steps` —— 它是**每轮**上限；
2. `trace` 里 `observation` 的字符串必须**逐字**对上（`记忆命中：-` 的连字符也要有），否则逐步比对全错；
3. 数值转字符串要用"最短形式"（`18` 而不是 `18.0`），`round()` 的默认字符串形态保留（`119.0`）；
4. `plan_stub.json` 的 `turn` 必须从 1 连续，否则 `dialogue[turn-1]` 取错轮次（造题侧已保证）。

## 5. 结论

循环与工具校验是最容易写错的部件：前者错在"上限口径"，后者错在"错误码粒度"。
值得换成真实模型的是"计划生成"那一层（`plan_stub.json`），其余五件都应该是确定性代码 ——
这也正是本实验想让学生看清的分工。

## 6. 产出图

- `figures/harness_overview.png`：每轮循环步数；case02 的第 2 轮被 `max_steps` 截断（图上 T2 最低）。
