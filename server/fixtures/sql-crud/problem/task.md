# 应用任务：给检验科做一个"能查、能改、能追溯"的小数据库

## 业务背景

你是某医院检验科信息组的新同学。科室现在有一批从不同系统导出的**原始数据**（患者、就诊、检验三张表），
还有一份当天的**临床更正单**（有报告要撤回、有就诊科室写错了要改、有漏录的业务要补）：

- 数据是**脏的**：日期格式不统一、字段前后有空格、有重复行、有空字段、还有"找不到对应就诊"的孤立报告；
- 科室要的是**结构化、可查询、可更正**的东西 —— 也就是一个**关系数据库**：表 + 主键 + 外键，用 SQL 存取；
- 更正单里还夹着一条**引用不存在就诊**的补录 —— 一个好的库应该**拒绝**它，而不是默默收下。

学完这一章你知道：关系数据库靠"表 + 主外键 + SQL"管结构化数据，强项是**精确、可统计、可事务**。
这次就把这套东西真正跑起来：**建库 → 清洗入库 → 增删改查 → 用 SQL 回答临床问题**。

## 你的任务

用工作目录里的 `patients.csv`、`visits.csv`、`labs.csv`、`corrections.json`，做一个**可复现的 SQLite 数据库
（文件 `clinic.db`）**，并产出报告 `output.json` 与一张图。具体要求：

1. **建库**：三张表（患者 / 就诊 / 检验），每张表有**主键**；`visits` 引用 `patients`、`labs` 引用 `visits`
   （外键）；**打开外键约束**（SQLite 里是 `PRAGMA foreign_keys = ON`）—— 否则那条孤立报告会被悄悄收下。
2. **清洗入库**：按下面的**清洗口径**逐字执行，脏行丢弃并**如实计数**（写进 `dropped`）。
3. **增删改查**：按 `corrections.json` 执行**删除 / 更新 / 插入**，并记录每类生效的条数与被**拒绝**的条数。
4. **用 SQL 回答临床问题**：更正之后，跑下面三个查询（口径写死，别自己加时间窗），把结果放进 `query_results`。
5. **用图说清结论**：把"各科室 HbA1c 超标患者数"画成一张条形图，写一句结论。

> 表名、列名、`CREATE TABLE` 的写法、清洗代码怎么写，**都由你自己决定**（用 `sqlite3` 标准库即可，
> 不必装任何东西）。达标看的是：口径一致 + 更正真的落到库里 + 查询结果对不对 + 能不能说清设计。

## 实验流程（六步，每一步都要走完）

| 步 | 做什么 | 产出/落点 |
|---|---|---|
| ① **看清需求** | 为什么要有主外键？"拒绝错误数据"和"能统计"分别靠什么机制 | 心里有数 |
| ② **先摸清数据** | 先数行数、再看脏在哪（重复？空字段？非正数检验值？日期格式？对不上的外键？） | 报告的 `profile` |
| ③ **设计并建库** | 三张表怎么划分、主键选谁、外键指向谁 | 报告的 `schema` |
| ④ **清洗入库** | 按口径清洗 → 入库（丢弃的行要计数） | 报告的 `loaded` / `dropped` |
| ⑤ **增删改查** | 按更正单 DELETE / UPDATE / INSERT，并观察外键拒绝了什么 | 报告的 `crud` |
| ⑥ **查询 + 写结论** | 三表 JOIN / GROUP BY 回答临床问题，画一张图，写清设计与不足 | 报告的 `query_results` / `figures` / `notes` |

> 图用 `matplotlib`（已预装）画，存到工作目录的 `figures/` 下，例如
> `plt.savefig("figures/hba1c_by_department.png", dpi=110)`。
> ⚠️ **图上的标题与坐标轴标签必须用英文**：运行环境里没有中文字体，中文会渲染成方框。
> 科室名的英文对照见下面的数据字典。中文解释写在 `figures[].takeaway` 与 `notes` 里。

## 清洗口径（**逐字执行**，顺序不能反）

对三张表分别执行，**表与表之间有依赖，顺序是 patients → visits → labs**：

1. **去空白**：每个字段去掉首尾空白（空格、制表符）。
2. **必填字段不能为空**，为空则整行丢弃：
   - `patients`：`patient_id`、`name`、`birth_date`、`sex`
   - `visits`：`visit_id`、`patient_id`、`department`、`visit_date`
   - `labs`：`report_id`、`visit_id`、`item`、`value`、`unit`
3. **日期统一成 `YYYY-MM-DD`**。输入里有三种格式，都要认：
   `2026-03-07`、`2026/3/7`（年月日）、`07-03-2026`（**日-月-年**）。无法解析 → 整行丢弃。
   涉及 `patients.birth_date` 与 `visits.visit_date`。
4. **`labs.value` 必须是能解析且大于 0 的数**，否则整行丢弃。
5. **引用完整性**（用**已经清洗完**的上一级表的 id 判断）：
   `visits.patient_id` 必须在 patients 里；`labs.visit_id` 必须在 visits 里。对不上 → 整行丢弃。
   > 注意级联：某条就诊因为 2/3/4 被丢掉时，挂在它下面的检验报告**也会对不上**，一并丢弃。
6. **去重**：同一张表内，**以上步骤处理完**的内容完全相同的行，只保留**首次出现**的那一行，其余丢弃。
7. 丢弃计数分两类写进报告：`dropped.invalid`（第 2/3/4/5 步丢的）与 `dropped.duplicates`（第 6 步丢的）。

## 更正口径（`corrections.json`，**在入库之后执行**）

| 字段 | 语义 | 你要做的 |
|---|---|---|
| `retract_labs` | 撤回误报的报告（报告号列表） | `DELETE FROM labs WHERE report_id = ?` |
| `update_visit_departments` | 更正就诊科室（`visit_id` + `new_department`） | `UPDATE visits SET department = ? WHERE visit_id = ?` |
| `add_visits` | 补录就诊（完整字段） | `INSERT INTO visits …` |
| `add_labs` | 补录检验报告 | `INSERT INTO labs …`；**其中有一条引用了不存在的就诊** —— 打开了外键约束的话它必须被**拒绝**，把条数记进 `crud.rejected_orphan_labs` |

## 查询口径（**更正之后**执行；三表都要用上）

| 键 | 要回答的问题 | 口径 |
|---|---|---|
| `q1_hba1c_patients` | 哪些患者的 HbA1c 超标？ | `labs.item = 'HbA1c'` 且 `labs.value >= 7.0` 的报告，取**患者 ID 去重**，按 `patient_id` **升序** |
| `q2_by_department` | 超标患者分布在哪些科室？ | 上面那批患者按 `visits.department` 分组，`COUNT(DISTINCT patient_id)`，按 `department` 升序 |
| `q3_frequent_patients` | 哪些患者查得最勤（≥3 次检验）？ | 按 `patient_id` 统计检验条数，取 **≥3** 的，按 `patient_id` 升序 |

## 数据字典

`patients.csv` / `visits.csv` / `labs.csv`：

| 文件 | 列 | 含义 |
|---|---|---|
| `patients.csv` | `patient_id` | 患者号（主键，形如 `P0007`） |
| | `name` | 姓名（虚构） |
| | `birth_date` | 出生日期 |
| | `sex` | 性别（男 / 女） |
| `visits.csv` | `visit_id` | 就诊号（主键，形如 `V0012`） |
| | `patient_id` | 外键 → `patients.patient_id` |
| | `department` | 就诊科室（中文，英文对照见下） |
| | `visit_date` | 就诊日期 |
| | `diagnosis` | 诊断 |
| `labs.csv` | `report_id` | 报告号（主键，形如 `R0031`） |
| | `visit_id` | 外键 → `visits.visit_id` |
| | `item` | 检验项目（`HbA1c` / `空腹血糖` / `肌酐` / `eGFR` / `白细胞`） |
| | `value` | 结果值（必须 > 0） |
| | `unit` | 单位 |

科室中英文对照（画图时用英文）：

| 中文 | 英文 |
|---|---|
| 内分泌科 | `Endocrinology` |
| 心内科 | `Cardiology` |
| 肾内科 | `Nephrology` |
| 消化内科 | `Gastroenterology` |
| 普通内科 | `General Medicine` |

> 数据是固定种子生成的虚构教学数据（**没有真实患者**），但规律符合临床常识：
> 内分泌科 / 肾内科查 HbA1c 更频繁、血糖控制更差。

## 交付格式

**`output.json`**（写在工作目录下；**键名与层级按下面的样例写**）：

```json
{
  "profile": {
    "raw_rows": { "patients": 42, "visits": 49, "labs": 121 },
    "problems_found": ["同一张表里有完全重复的行", "有字段是空的", "检验值不是正数（或不是数字）", "日期格式不统一", "可能有外键对不上的行（检验报告的 visit_id / 就诊的 patient_id）"]
  },
  "schema": {
    "tables": [
      {
        "name": "patients",
        "columns": [["patient_id", "TEXT"], ["name", "TEXT"], ["birth_date", "TEXT"], ["sex", "TEXT"]],
        "primary_key": ["patient_id"],
        "foreign_keys": []
      }
    ]
  },
  "loaded": { "patients": 39, "visits": 43, "labs": 101 },
  "dropped": { "invalid": 19, "duplicates": 10 },
  "crud": {
    "deleted_labs": 2, "updated_visits": 1, "inserted_visits": 1, "inserted_labs": 1,
    "rejected_orphan_labs": 1, "final_visits": 44, "final_labs": 100
  },
  "query_results": {
    "q1_hba1c_patients": ["P0004", "P0007"],
    "q2_by_department": [{ "department": "内分泌科", "n_patients": 10 }],
    "q3_frequent_patients": [{ "patient_id": "P0004", "n_labs": 4 }]
  },
  "figures": [
    { "path": "figures/hba1c_by_department.png", "takeaway": "更正后 HbA1c >= 7.0 的患者共 13 人，最多的是内分泌科（10 人）；内分泌科与肾内科合计占了大多数。" }
  ],
  "notes": "原始三张表 42/49/121 行，清洗后入库 39/43/101 行：丢弃 19 行（空字段、非正数检验值、外键对不上的行）与 10 行重复行。表设计成患者—就诊—检验三层……"
}
```

- `schema.tables[].columns` 用 `[列名, 类型]` 的二元数组；`foreign_keys` 每项形如
  `{ "from": "patient_id", "to_table": "patients", "to": "patient_id" }`。
- `query_results` 的三个键的名字、元素字段名都要与样例一致。
- 图至少 1 张：`path` + 一句 `takeaway`（结论要"看图说话"，并与你报的数字自洽）。
- 报告里的数值**不需要**和任何人一致 —— 只要口径对，它们**本来就该相同**；口径错了就会不一样。

## 怎么算完成

1. 写一个能跑的方案（推荐做成 Skill 里的一段脚本），能对任意一份同结构的数据 + 更正单
   产出 `clinic.db`、`output.json` 与一张图。
2. 在 `cases/case01` 与 `cases/case02`（两批不同规模的数据）上都能跑通 —— 判据对两个 case 各判一次。
3. 把结论与踩过的坑写进 `SKILL.md` 的「实测档案」。

判据全文见 `judge.md`；怎么自测、包内还有什么，见 `README.md`。
