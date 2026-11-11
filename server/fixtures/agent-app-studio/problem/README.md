# 包内说明（综合实践 · 可分享的智能体应用）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、附件解析 / 报告 / 记忆 / 前端分享的口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两套输入（请求 + 三类附件 + 模板 + 知识库）+ `expected.json`（自测用） |
| `manifest.json` | IO 契约（`outputFile`、输入、断言）—— 平台复验用它 |

> ⚠️ **本实验不给参考实现**。它接在第 19 章之后：那一章的六件（循环 / 记忆 / 工具 / 检索 / 安全 / 出处）
> 直接复用，这一章新增**三件**：**附件解析**、**口径钉死的报告**、**改过的前端 + 可发布**。
> 卡住时翻回第 19 章，以及第 18 章的"确定性下沉给脚本"。

## 本地自测（两个 case 都要跑）

```sh
mkdir -p /tmp/app-run && cd /tmp/app-run

# 用你的 core 跑一遍（胶水 `harness/run.py` 已给好，不用改）
python3 <skill>/harness/run.py <题目包>/cases/case01 ./output.json

# 想在浏览器里看：把 web/ 与 app.json 放在一起，然后
APP_DIR=<skill> python3 <skill>/app_host.py     # 打开 http://127.0.0.1:9200
```

然后自己核对九件事（这就是判据的口径）：

1. **附件解析**：`attachments` 的 `[name, kind, via, rows, chars, checksum]` 与 `expected.json` 一致
   —— PDF/DOCX 是 `via="text"`（`checksum` = 文本 `sha256` 前 12 位），
   **图片是 `via="vision"`**（先调视觉模型读出数据行，`checksum` = 结构化行 `sha256` 前 12 位）；
2. **循环**：`trace` 的 `[turn, step, action, observation]` 逐步一致；`harness.terminated` 每轮一条；
3. **工具**：`[call_id, tool, args_valid, status, error_code, rejected_reason, result_summary]` 一致；
4. **报告**：四节名称与顺序同模板、每节 ≥ `min_chars`；`metric_rows` 逐行 `[item, value, unit, flag]` 一致；
5. **计数**：`report.counts` 的 `total / abnormal / listed` 与 `metrics.report_rows / abnormal_rows` 自洽；
6. **记忆**：`memory.long` 三态一致；**`listed` 的变化要能对上**（偏好生效 vs 忘掉之后）；
7. **检索**：每轮 `bm25_top3` 与 `cosine_top3` 一致；
8. **安全**：`safety.escalations` 的 `[record_id, item, value, message]` 一致、`safety.refusals` 轮次一致、
   拒答轮 `citations` 为空；
9. **前端**：`app.web_sha256` **必须不等于** `template.json` 的基线（交模板会被抓出来），
   `theme.accent` 与 `theme.css` 的 `--accent` 一致。

> `expected.json` 是**参考水平**不是标准答案（由教师侧解答样例算出，不随包下发）。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| 解析出的行数比 expected 少 | 只抽了"看起来像数据"的行 | 口径是：**所有** `ITEM,VALUE,UNIT` 三元组行都登记，`备注:` 之类的非数据行忽略（行仍计入 `chars`） |
| `chars` 对不上 | 把 PDF 的头部/尾部也算进去了 | 只算**抽出来的文本行**（`Tj` 里的内容 / `<w:t>` 的内容），不含 PDF 结构字符串 |
| 图片 `checksum` 对不上 | 对文件字节/原始模型输出做了哈希 | 图片 `via="vision"`：先抽成 `item,value,unit` 行，再对**规范化行文本**算哈希 |
| 图片解析出 0 行 | 没调视觉，或者 `max_tokens` 太小被思维链吃光 | 模型 `deepseek-flash` + `image_url`（data URI），`max_tokens` 给到 800、`reasoning_effort: none` |
| 视觉调用报 401 / 连不上 | 没有 `DEEPSEEK_API_KEY`，或端点写错 | key 已在环境变量里；端点 `https://api.deepseek.com`（可用 `DEEPSEEK_BASE_URL` 覆盖） |
| `listed` 与 `total` 总是一样 | 偏好没生效 | 报告要按**本轮记忆更新之后**的状态生成；`报告只列异常指标` 生效时只列 `flag != normal` |
| `web_sha256` 等于基线 | 直接交了模板 | 改 `web/`（换主题色、加区块、改文案），再按口径重算哈希 |
| 拒答轮还带了引用 | 拒答和正常回答走了同一条分支 | 拒答轮 `citations` 必须是空数组 |
| `python3 app_host.py` 起不来 | 端口占用或缺 `app.json` | `APP_PORT=9300 python3 app_host.py`；`app.json` 要与 `web/` 同级目录 |
