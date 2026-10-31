# 最小 MCP 服务器（学生起点）

> 这个目录是**你的方案**：`SKILL.md` 写"这个技能什么时候该用、不该用"，
> `report.md` 记录自测与踩坑。**代码里的 TODO 才是你要改的地方**（文档不用改）。

## 实验材料（都在题目包 `problem/` 里）

- `problem/task.md` —— 三类响应、两种错误码、三种工具文本、交付格式、验收标准
- `problem/cases/` —— case01（2 个工具 / 9 条请求）/ case02（3 个工具 / 6 条请求），各带 `expected.json`
- `problem/judge.md` —— 语义判据
- `problem/reference/` —— 一份走完六步的示范

## 能力边界

> 这一节是技能说明书的一部分；**平台不检查这一节**，按实际情况补两句即可。

- 能处理：stdio 上"一行一条 JSON-RPC"的 `initialize` / `tools/list` / `tools/call`（以及通知）
- 不处理：resources / prompts 原语、流式返回、鉴权与审计、并发与超时 —— 真实服务器要单独做
- 写死的假设：`protocolVersion` 固定 `2024-11-05`；错误码只有 `-32601` / `-32602`；工具文本格式见 `task.md`

## 六步流程

① 看清需求（result / error / 不响应三类）→ ② 看数据（工具与 `required`）→ ③ 写握手与清单 →
④ 写调用（查工具名 → 查参数 → 执行）→ ⑤ 统计 → ⑥ 写结论

材料配合：读 `problem/task.md` → 改 `scripts/solve.py` 里的 TODO → 两个 case 都跑 →
补能力边界（平台不检查）→ 提交；**报告写进 `report.md`**（平台按它评过程分）。

## 自测

```sh
python3 scripts/solve.py ../problem/cases/case01 ../case01/output.json --fig-dir figures/case01
python3 scripts/solve.py ../problem/cases/case02 ../case02/output.json --fig-dir figures/case02
```
