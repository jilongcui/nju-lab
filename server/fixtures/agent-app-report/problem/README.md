# 包内说明（入门实验 · 附件 → 报告）

| 文件/目录 | 作用 |
|---|---|
| `task.md` | 题干：从这里开始 5 步、口径、数据字典、交付格式、自查清单 |
| `judge.md` | 语义判据（说清理由 / 不越界 / 正视局限） |
| `cases/case01`、`case02` | 两套输入（三份附件 + 报告模板 + 简报）+ `expected.json` |
| `reference/` | **参考实现（随包下发，先读后仿）**：`harness/api.py` + `harness/run.py` + `app_host.py` |
| `manifest.json` | IO 契约（`outputFile=output.json`、9 条断言） |

## 本地自测

```sh
python3 harness/run.py <题目包>/cases/case01 ./output.json
```

## 常见问题

| 现象 | 原因 |
|---|---|
| 图片那行是 0 | 没走视觉通道：图片没有文本层，要用 `app_host.vision_extract` |
| `chars` 对不上 | 把 PDF 结构字符串也算进去了 —— 只算抽出来的文本行 |
| `flag` 出现自造值 | 只能用 `low / high / normal` |
| 计数对不上 | `counts.total` 必须是各附件 `rows` 之和 |
