# 随访助手的记忆表（学生起点）

> 这个目录是**你的方案**：`SKILL.md` 写"这个技能什么时候该用、不该用"，
> `report.md` 记录自测与踩坑。**代码里的 TODO 才是你要改的地方**（文档不用改）。

## 实验材料（都在题目包 `problem/` 里）

- `problem/task.md` —— 四个操作的口径、三条边界、交付格式、验收标准
- `problem/cases/` —— case01（5 条种子 / 6 个操作）/ case02（4 条种子 / 6 个操作），各带 `expected.json`
- `problem/judge.md` —— 语义判据
- `problem/reference/` —— 一份走完六步的示范

## 能力边界

> 这一节是技能说明书的一部分；**平台不检查这一节**，按实际情况补两句即可。

- 能处理：与 `memory_seed.json` 同结构的条目表（`id / patient / fact / kind / status`）+ 四个操作
- 不处理：语义检索（同义改写）、条目抽取（从对话里自动生成记忆）、冲突消解（两条互相矛盾时该信哪条）
- 写死的假设：状态只有三种；更新产生的 id 固定为 `<旧id>v2`；检索按 `id` 升序

## 四操作与六步

① 看清需求（三种状态 + 两条边界）→ ② 看数据（种子里有没有已作废的条目）→ ③ 实现四操作 →
④ 每次检索都过滤状态 → ⑤ 核对最终计数与被遗忘的条目 → ⑥ 写结论

材料配合：读 `problem/task.md` → 改 `scripts/solve.py` 里的 TODO → 两个 case 都跑 →
补能力边界（平台不检查）→ 提交；**报告写进 `report.md`**（平台按它评过程分）。

## 自测

```sh
python3 scripts/solve.py ../problem/cases/case01 ../case01/output.json --fig-dir figures/case01
python3 scripts/solve.py ../problem/cases/case02 ../case02/output.json --fig-dir figures/case02
```
