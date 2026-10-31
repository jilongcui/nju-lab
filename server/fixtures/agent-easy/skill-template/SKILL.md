# 四环随访助手（学生起点）

> 这个目录是**你的方案**：`SKILL.md` 写"这个技能什么时候该用、不该用"，
> `report.md` 记录自测与踩坑。**代码里的 TODO 才是你要改的地方**（文档不用改）。

## 实验材料（都在题目包 `problem/` 里）

- `problem/task.md` —— 需求 + 六条决策规则 + 消息模板 + 交付格式 + 验收标准
- `problem/cases/` —— case01（5 患者 / 6 请求）/ case02（4 患者 / 5 请求），各带 `expected.json`
- `problem/judge.md` —— 语义判据
- `problem/reference/` —— 一份走完六步的示范

## 能力边界

> 这一节是技能说明书的一部分；**平台不检查这一节**，按实际情况补两句即可。

- 能处理：与 `patients.csv` 同结构的随访名单 + 一句一条的请求文本
- 不处理：自由口语（"她最近老是口渴"）、多患者一句话、需要医学判断的请求 —— 那些要靠大模型做感知与决策
- 写死的假设：今天固定 `2026-10-01`；六条规则与优先级按 `task.md`；消息模板逐字不变

## 四环与六步

① 看清需求（六条规则的顺序、模板、记忆边界）→ ② 看数据 → ③ 写感知 → ④ 写决策与行动 →
⑤ 写记忆（同一次运行内第二条同患者请求要读到第一条写下的时间）→ ⑥ 写结论

材料配合：读 `problem/task.md` → 改 `scripts/solve.py` 里的 TODO → 两个 case 都跑 →
补能力边界（平台不检查）→ 提交；**报告写进 `report.md`**（平台按它评过程分）。

## 自测

```sh
python3 scripts/solve.py ../problem/cases/case01 ../case01/output.json --fig-dir figures/case01
python3 scripts/solve.py ../problem/cases/case02 ../case02/output.json --fig-dir figures/case02
```
