# 包内说明（应用实践 · 写一个 Skill）

| 文件/目录 | 作用 |
|---|---|
| `task.md` | 题干：从这里开始 5 步、`handle()` 四件事、口径、数据字典、交付格式、自查 |
| `judge.md` | 语义判据 |
| `cases/case01`、`case02` | **示例数据（可不用）**：三份附件 + 多轮请求 + 报告模板 + 知识库 + `expected.json`<br>本章数据由学生自己准备，这两份只是"跑通链路"的样例 |
| `reference/` | **参考 Skill（随包下发）**：`SKILL.md` + `scripts/api.py` + `run_case.py` + `platform_core.py` |

## 本地自测

```sh
python3 run_case.py <题目包>/cases/case01 ./output.json
```

`run_case.py` 用的是**平台 harness 的等价物**（`platform_core.py`）：附件解析、图片视觉、记忆、
安全兜底都与平台一致 —— 本地跑通，发布后就该是这个效果。

## 常见问题

| 现象 | 原因 |
|---|---|
| 图片那行没进报告 | 你没用 `attachments[].rows`（图片已由平台读出，`via="vision"`） |
| 「只列异常」那轮行数没变 | 没看 `state["memory"]`（平台会把偏好放进去） |
| 「忘掉」之后还是只有异常行 | 把偏好缓存进了 `session`，忘掉后没重算 |
| 拒答那轮还带引用 | 拒答由平台兜底替换（`citations` 会被置空），你只要别自己造引用 |
