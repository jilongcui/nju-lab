# 入门实验：把检验判定写成脚本（口径与边界 · 容易）

## 业务背景

"这一项高不高、要不要紧"是检验报告解读里最基础、也最不能含糊的一步。让大模型直接判断，
同一份报告单你会得到"偏高 / 略高 / 需要关注"三种说法 —— **都对，都不能用**：报告需要一个确定的 `flag`。

本章正文讲的"**确定性任务下沉给脚本**"就是这个意思：模型负责解释"血钾高通常意味着什么"，
**判定**交给代码。这个入门实验让你把这套判定完整写一遍，重点体会两条口径：

- **危急值用闭区间**：恰好等于危急阈值也必须报警（宁可多提醒，不可漏）；
- **没有依据不许猜**：参考区间表里没有的项目、报告单上没填数值的项目，一律 `unknown`。

## 你的任务

case 目录里有两个输入：

| 文件 | 内容 |
|---|---|
| `report.csv` | 报告单（`item,value`；case01 10 行 / case02 12 行；有 1~2 行是空的或表外项目） |
| `reference_ranges.csv` | 参考区间表（`item,unit,ref_low,ref_high,critical_low,critical_high`；空格 = 该侧不判） |

逐行判定，把结果写进 `output.json`，再画一张「各类 flag 的项数」柱状图。

**判定口径（写死，顺序也不能变）**

| 顺序 | 条件 | flag |
|---|---|---|
| 1 | 参考区间表里**没有**这个项目 | `unknown` |
| 2 | 报告单上这一行**没有数值** | `unknown` |
| 3 | `critical_high` 有值 且 `value >= critical_high` | `critical_high` |
| 4 | `critical_low` 有值 且 `value <= critical_low` | `critical_low` |
| 5 | `ref_high` 有值 且 `value > ref_high` | `high` |
| 6 | `ref_low` 有值 且 `value < ref_low` | `low` |
| 7 | 其余 | `normal` |

注意第 3/4 条是 `>=` / `<=`（**等于也算**），第 5/6 条是 `>` / `<`（**等于参考边界算正常**）。
`unknown` 的行**不进** `critical_alerts`，也不许"顺手判个偏高"。

## 实验流程（六步）

| 步 | 做什么 | 产出 |
|---|---|---|
| ① 看清需求 | 七条判定顺序、闭区间与严格不等的差别 | 心里有数 |
| ② 看数据 | 有几行、哪几行是空值或表外项目、区间表哪些格是空的 | 心里有数 |
| ③ 实现判定 | 一条一行，先查表再比大小 | `items` |
| ④ 抽危急值 | 每条带**依据阈值**，没有就空数组 | `critical_alerts` |
| ⑤ 计数核对 | 六类 flag 各几项 | `summary` |
| ⑥ 写结论 | 为什么要下沉脚本、边界为什么必须写死 | `report.md` |

## 交付格式

**`output.json`**（写在工作目录下）：

```json
{
  "items": [
    { "item": "K", "value": 6.2, "unit": "mmol/L", "flag": "critical_high", "critical": true,
      "reason": "≥ 危急阈值 6.2（闭区间，等于也算）" }
  ],
  "critical_alerts": [
    { "item": "K", "value": 6.2, "threshold": 6.2, "side": "high" }
  ],
  "summary": { "counts": { "normal": 3, "high": 1, "low": 1, "critical_high": 2, "critical_low": 2, "unknown": 1 },
               "n_unknown": 1 },
  "figures": [{ "path": "figures/flags.png", "takeaway": "……（一句话：几项危急、几项 unknown）" }],
  "notes": "……（≥40 字：为什么判定要写脚本、两条边界各是什么）"
}
```

- `items` **与 `report.csv` 行序一致**；`value` 是**数字**（`unknown` 且无值时写 `null`）；
- `critical_alerts` 按 `items` 顺序；`side` 取 `high` / `low`；
- `summary.counts` **六个键都要有**（没有的记 0）。

## 怎么算完成（验收标准）

1. **两个 case 都跑通**：`items`（`item`/`value`/`flag`/`critical` 四个字段）/ `critical_alerts` / `summary`
   与 `cases/<case>/expected.json` **逐字段一致**；
2. **两条边界不能错**：
   - 恰好等于危急阈值的那几项（case01 的 `K 6.2`、`GLU 2.8`）**必须报警**；
   - 表外项目（case01 的 `FT4`）与空值行（case02 的 `HBA1C` 空）**必须判 `unknown`**，不许猜；
3. 图能打开、`takeaway` 与 `summary.counts` 自洽；
4. 结论与踩坑记下来——报告会由工具整理进 `report.md`，**不需要改 `SKILL.md`**。

判据全文见 `judge.md`。
