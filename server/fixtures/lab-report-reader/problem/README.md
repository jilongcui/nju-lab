# 包内说明（技能 Skill 实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、清洗口径、判定口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两批数据（不同规模），每个 case 有 `lab_report.csv` / `reference_ranges.csv` / `patient.json` 与 `expected.json` |
| `reference/` | **参考实现**（一份写完的方案）—— 先读后仿，不是标准答案 |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

## 本地自测（两个 case 都要跑）

把工作目录切到某一个 case，脚本把 `output.json` 与图写到当前目录：

```sh
mkdir -p /tmp/lab-report-run && cd /tmp/lab-report-run

# 用参考实现跑一遍（看看"对的"长什么样）
python3 <题目包>/reference/scripts/read_report.py <题目包>/cases/case01 ./output.json

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/read_report.py <题目包>/cases/case01 ./output.json
```

然后自己核对四件事（这就是判据的口径）：

1. **清洗**：`dropped.invalid` / `dropped.duplicates` 与 `cases/<case>/expected.json` 相同；
2. **逐项判定**：`items` 里每一项的 `flag` / `critical` 与 `expected.json` 一致（**顺序也要按 `item` 升序**）；
3. **危急值**：`critical_alerts` 的项目名单与 `expected.json` 的 `critical_item_names` 一致；
4. **不确定的项**：`unknown_items` 与 `expected.json` 一致（表外项目判 `unknown`，不许猜）。

> `expected.json` 是**参考水平**不是标准答案：判定口径已经钉死，所以只要口径对，
> 这些判定本来就该相同；口径错了就会不一样 —— 它同时是你自查"我有没有漏掉某一类脏数据"的镜子。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| 某一项该判 `high` 却判了 `normal` | 把 `value` 里带的全角数字当成了非法值或字符串比较 | 先按 NFKC 转半角再去空白，然后 `float()` 比较（`６．４` → `6.4`） |
| 恰好等于参考上限的项目判成了 `high` | `flag` 的口径是**严格不等** | `value > ref_high` 才算高；等于上限算正常 |
| 恰好等于危急阈值的项目没进 `critical_alerts` | 危急值的口径是**闭区间**（安全侧） | `value >= critical_high` / `value <= critical_low` 就要报警 |
| 重复行把第一行顶掉了（比如 K 记成了 7.1） | 去重口径是**保留首次出现** | 重复行整行丢弃，丢弃的计数进 `dropped.duplicates` |
| 表外项目被判成了 `normal` | 没有区间就无从判断 | 判 `unknown`、`ref_low`/`ref_high` 写 `null`、item 名进 `unknown_items` |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标题/轴标签用英文，中文写在 `takeaway` / `summary` / `notes` 里 |
