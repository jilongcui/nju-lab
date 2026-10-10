# 数据库实验一：检验数据登记与查询（关系数据库 · SQL 增删改查）

**形态：应用驱动**（`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6）—— 学生拿到的是**需求**而不是
"表结构 + 一句句 SQL"：要解决的问题（科室要一个能查、能改、能追溯的小库）、约束（清洗口径、
主外键、必须拒绝孤儿报告）由题干给出；**表怎么建、DDL 怎么写、清洗代码怎么组织由学生自己决定**，
判据按"口径是否一致 + 更正是否真的落到库里 + 查询结果对不对 + 能不能说清设计"判。

**教学向设计**（§3.5 七件事）：学习目标 / 知识铺垫 / 导学步骤 / 参考资料与 FAQ 见下方
「项目字段文案」；参考实现随包下发（`problem/reference/`）、骨架留解释层、反思环节落在骨架的
「能力边界」「实测档案」。

```
sql-crud/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 12 条确定性断言
│   ├── task.md         需求 + 六步流程 + 清洗/更正/查询口径 + 数据字典 + 交付格式
│   ├── judge.md        语义判据（表结构是否关系式、问题清单是否自洽、图与数字自洽、说清机制）
│   ├── README.md       导学
│   ├── cases/case0N/{patients.csv,visits.csv,labs.csv,corrections.json,expected.json}
│   └── reference/      参考实现（清洗 + 建库 + 增删改查 + 三表 JOIN + 一张图）
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，三处 TODO 自己填）
├── tools/gen_data.py                        造题工具：固定种子生成数据并规律地"弄脏"（**不下发**）
└── README.md
```

## 场景与数据

- 应用：检验科信息组把"从不同系统导出的三张表"整理成**能查、能改、能追溯**的关系数据库
- 对应章节：课程第 6 章《关系数据库》（正文里的「患者表 / 就诊表 / 检验表」三表例子）
- 数据（合成，固定种子，无真实患者）：

| 文件 | 列 | 说明 |
|---|---|---|
| `patients.csv` | `patient_id,name,birth_date,sex` | 患者主数据 |
| `visits.csv` | `visit_id,patient_id,department,visit_date,diagnosis` | 就诊（外键 → 患者） |
| `labs.csv` | `report_id,visit_id,item,value,unit` | 检验报告（外键 → 就诊） |
| `corrections.json` | — | 临床更正单：撤回报告 / 更正科室 / 补录就诊与检验 |

| case | 规模 | 特点 |
|---|---|---|
| case01 | 患者 40 / 就诊 49 / 检验 121 行（脏化后） | 常规批量 |
| case02 | 患者 55 / 就诊 65 / 检验 ~180 行 | 更大批量，脏行更多 |

**脏化规则**（`tools/gen_data.py`，与 `task.md` 的清洗口径一一对应）：字段首尾加空格、
日期混用 `YYYY-MM-DD` / `YYYY/M/D` / `DD-MM-YYYY`、整行复制、必填字段置空、检验值置 0/负数、
外键指向不存在的 id。

## 判据设计要点

1. **口径钉死，结果确定**（这就让"逐字段比对"成立）：清洗 6 条 + 更正 4 类 + 查询 3 个问题都写进
   `task.md`，所以 `loaded` / `dropped` / `query_results` 是唯一确定的。
2. **"外键真的生效"是硬性条件**：更正单里**故意放了一条引用不存在就诊的报告**，
   断言要求 `crud.rejected_orphan_labs === 1` —— 没打开 `PRAGMA foreign_keys` 就过不了。
   这是本实验最能把"约束"讲清楚的判据。
3. **表结构要真关系化**：断言核对"每张表有主键、至少两张表声明了外键"，
   并用 `schema` 字段把学生自报的结构带出来给 judge 判设计质量。
4. **级联丢弃要算对**：某条就诊被丢掉时，挂在它下面的检验报告会一并变孤儿 ——
   `loaded.labs` 比"原始行数 − 坏行数"少得多，这是学生最容易算错的地方（也在 FAQ 里点明）。
5. **语义交给 judge**：表结构是否按实体拆表、`problems_found` 与 `dropped` 是否自洽、
   图的结论与查询结果是否自洽、`notes` 有没有讲清"外键拒绝意味着什么"。

### 出题时的实测依据（不是推测，2026-10-10 在本机复验镜像里跑）

| case | 入库（患者/就诊/检验） | 丢弃（无效 / 重复） | 更正 | q1 超标患者 |
|---|---|---|---|---|
| case01 | 39 / 43 / 101 | 19 / 10 | 删 2、改 1、增 1 就诊 + 1 检验、拒绝 1 | 13 人（3 个科室：10/2/1） |
| case02 | 53 / 58 / 127 | 29 / 12 | 同上 | 15 人（4 个科室） |

参考实现复验：**2/2 case 通过、硬性断言 12/12**，单轮 dsh 59s / 65s（`VERIFY_REASONING_EFFORT=low`）。

## 项目字段文案（上传到平台时用）

**objectives**

1. 说清关系数据库为什么用"表 + 主键 + 外键"组织数据：主键让一行能被唯一指认，外键让库里不会留下查不到患者的报告。
2. 能把一个临床问题翻译成 SQL：三表 JOIN 做筛选、`GROUP BY` 分组、`HAVING` 过滤分组结果。
3. 能说清清洗顺序为什么重要（先校验再去重、父表先于子表），并解释"级联丢弃"是怎么发生的。

**background**

- 关系模型：行是一行记录、列是一个属性；主键唯一标识一行，外键指向另一张表的主键。
- 四类操作对应"增删改查"：`INSERT` / `DELETE` / `UPDATE` / `SELECT`。
- 约束不是"文档要求"，是**数据库会拒绝坏数据**的机制（本实验的外键拒绝就是例子）。
- SQLite：单文件、免安装，Python 标准库自带 `sqlite3`；但 `PRAGMA foreign_keys` 默认是**关**的。
- 数据从"导出文件"到"能查的库"之间的那一步就是清洗 —— 顺序错了结果就错。

**description**（导学步骤）

1. 读 `task.md`：先看清"清洗口径 / 更正口径 / 查询口径"和 `output.json` 的键名。
2. **先摸清数据**：只数行数、看脏在哪几类（重复？空字段？非正数检验值？日期格式？对不上的外键？）。
3. **设计并建库**：把三张表建出来，主键、外键都要有，并打开 `PRAGMA foreign_keys = ON`。
4. **清洗入库**：按口径逐字执行（顺序 patients → visits → labs；先校验再去重），把丢弃的行计数。
5. **执行更正单**：`DELETE` / `UPDATE` / `INSERT` 各来一遍；观察那条引用不存在就诊的报告**被拒绝**。
6. **用 SQL 回答三个问题**（三表 JOIN + `GROUP BY` + `HAVING`），结果写进 `query_results`。
7. **画一张图**：各科室 HbA1c 超标患者数（标题与轴标签用英文），并写一句结论。
8. **自测两个 case**：与 `cases/<case>/expected.json` 对照；把结论与踩坑写进 `SKILL.md` 的「实测档案」。

**references**

- SQLite SQL 语法：<https://www.sqlite.org/lang.html>
- SQLite 外键约束（含 `PRAGMA foreign_keys`）：<https://www.sqlite.org/foreignkeys.html>
- SQL 入门教程：<https://www.w3schools.com/sql/>
- 课程第 6 章《关系数据库》；MIMIC 重症数据库（真实临床数据，注册后可用）：<https://physionet.org/content/mimiciv/>

**faq**

- **`loaded.labs` 比预期少很多？** 级联丢弃：有些就诊行被丢掉了，挂在它下面的检验报告就对不上了，
  按口径要一并丢弃。先看 `dropped.invalid` 有多大。
- **那条补录的报告没被拒绝？** SQLite 的外键约束默认关闭，每个连接都要 `PRAGMA foreign_keys = ON`。
- **去重数量对不上？** 口径是"**先校验、再去重**"：空字段/非法值/孤儿行先被丢弃，不参与去重比较。
- **`07-03-2026` 是几月几号？** 口径是 **日-月-年** → 2026-03-07。
- **图里的中文变成方框？** 运行环境没有中文字体，图的标题/轴标签用英文，中文写在 `takeaway` / `notes`。

## 打包 / 自检 / 上传

```sh
cd server/fixtures/sql-crud
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构与依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧闭环：拿参考实现跑一遍复验（应 2/2 通过）
docker run --rm --env-file ../../../server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low \
  -v "$PWD:/p:ro" -v "$PWD/../../../.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/sql-crud.json --timeout-ms 300000
```

上传两个 ZIP 拿 `fileId`，在项目里绑到「Skill 模板」「题目包」两个位置，再用
`chapterId` 挂到课程《分子医学人工智能理论与实验》第 6 章《关系数据库》下并 publish
（命令见 `docs/EXPERIMENT-CREATION-GUIDE.md` 步骤 11）。
