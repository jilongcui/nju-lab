# 包内说明（综合实践 · 收官实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、五件事的契约（记忆 / 工具 / 报告 / 引用 / 安全）、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两种规模与指标，各含六份输入文件与 `expected.json` |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

> ⚠️ **本实验不给参考实现**（前 18 章的实验包里都有 `reference/`，这一章没有）。
> 原因：这是**收官 · 迁移检验** —— 考察你能不能在只有"需求 + 数据 + 交付契约"的情况下，
> 把第 16 章的"本地记忆条目表"、第 18 章的"确定性任务下沉给脚本 + 安全边界落成字段"、
> 第 5 / 9 章的"口径钉死 + 逐字段可比"**自己组装起来**。卡住时请回头翻你做过的实验。

## 本地自测（两个 case 都要跑）

```sh
mkdir -p /tmp/assistant-run && cd /tmp/assistant-run

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/learning_assistant.py <题目包>/cases/case01 ./output.json
```

然后自己核对八件事（这就是判据的口径）：

1. **工具调用**：每条 `[call_id, tool, args_valid, status, rejected_reason, result_summary]` 与
   `expected.json` 的 `tool_calls` 一致（注意：**里面有非法调用，必须如实记 rejected**）；
2. **记忆**：`memory.written` 的 `[entry_id, fact, category]` 与 `memory.applied` 的
   `[question_id, entry_id]` 一致；
3. **报告**：四节的 `name` 与顺序同模板，每节 `content` 长度 ≥ 模板的 `min_chars`；
4. **出处**：`citations` 的 `[kind, ref]` 与顺序一致（先 data 后 passage）；
5. **安全**：`safety.escalations` 的 `[row_id, item, message]` 一致（`message` 与模板里的固定话术**逐字相同**）、
   `safety.refusals` 命中的 `question_id` 一致；
6. **关键事实**：`key_facts` 五个字段与 `expected.json` 一致；
7. **图**：至少 1 张，`takeaway` 与 `key_facts` 自洽；
8. **`notes`**：讲清每一环为什么这么做、至少两条局限。

> `expected.json` 是**参考水平**不是标准答案（它由教师侧的解答样例算出，不随包下发）：
> 口径钉死的部分只要做对就该完全相同；口径错了就会不一样 —— 它同时是你自查"我哪一步理解偏了"的镜子。
> 报告正文与你自己的措辞**不在**逐字比对范围里（只判篇幅与语义）。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| 非法调用被我"跳过"了 | 只记录了成功的调用 | 口径是**每条 `tool_calls.csv` 都要出现在报告里**，非法的记 `args_valid=false` / `status="rejected"` + 非空 `rejected_reason` |
| `rejected_reason` 写成了"参数不对" | 理由的取值是**枚举** | 只能是 `unknown_tool` / `invalid_args` / `missing_required` / `type_mismatch` 之一 |
| 合法项也写了 `rejected_reason` | 合法项该留空 | `args_valid=true` 时 `rejected_reason` 写 `""` |
| `missing_required` 与 `type_mismatch` 分不清 | 校验**顺序**没按口径 | 顺序是：未知工具 → args 不是对象 → 缺必填 → 类型不符，**命中即停** |
| `mean_of_column` 的结果差一点 | `decimals` 缺省不是 0，或没做四舍五入 | 缺省 `decimals=0`；摘要用 `round(均值, decimals)` 的默认字符串形式（如 `9.0`） |
| `fetch_reference` 取错了段落 | 没有取 `passage_id` **最小**的那条 | 同一个 item 可能有多条段落，口径是取最小的那个 |
| `citations` 顺序不对 | 排序规则没照做 | 先全部 data（按 `row_id` 升序），再全部 passage（按 item 字符串升序） |
| `escalations` 的 message 与预期不同 | 自己改了固定话术 | 必须**一字不改**地抄 `report_template.json` 的 `messages.warn` |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标签用 `item 1` / `item 2` 这类**编号**（ASCII），中文对应关系写在 `takeaway` 里 |
| 报告正文里有诊断结论 | 越界了 | 报告只描述"这一行超出了警戒线"，**不下诊断**；判断留给医师 |
