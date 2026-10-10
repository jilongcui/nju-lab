# 技能实验：检验报告解读 Skill（第 18 章 · 口径比对 + 危急值拦截 + 技能卡）

**形态：应用驱动**（`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6）—— 学生拿到的是**需求**（把社区医院
"报告单解读"的流程固化成一个 Skill），而不是"按口径写代码"：判定口径是业务规则（必须照做），
但**函数怎么切、图怎么画、文案怎么写由学生自己决定**；判据看的是"口径一致 + 危急值抓得全 +
不确定的项如实报 + 不越界下诊断 + 说得清"。

**教学向设计**（§3.5 七件事）：学习目标 / 知识铺垫 / 导学步骤 / 参考资料与 FAQ 见下方
「项目字段文案」；参考实现随包下发（`problem/reference/`）、骨架留解释层、反思环节落在骨架的
「能力边界」「实测档案」。

```
lab-report-reader/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 12 条确定性断言
│   ├── task.md         需求 + 六步流程 + 清洗口径 + 判定口径 + 数据字典 + 交付格式
│   ├── judge.md        语义判据（description 是否触发路由、是否越界下诊断、依据是否自洽）
│   ├── README.md       导学
│   ├── cases/case0N/{lab_report.csv,reference_ranges.csv,patient.json,expected.json}
│   └── reference/      参考实现（清洗 + 逐项比对 + 危急值 + 一张图 + 技能卡）
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，三处 TODO 自己填）
├── tools/gen_data.py                        造题工具：显式写死数据并"弄脏"（**不下发**）
└── README.md
```

## 场景与数据

- 应用：社区医院检验科把"报告单解读"固化成一个可复用、可治理的 Skill
- 对应章节：课程《分子医学人工智能理论与实验》**第 18 章《技能 Skill 的创建与使用》**
  （正文的「检验报告解读 Skill + 三个测试用例 + hooks 拦截危急值」）
- 数据（合成，无真实患者）：

| 文件 | 列 | 说明 |
|---|---|---|
| `lab_report.csv` | `item,value,unit` | 报告单（值里**故意**混入全角数字、前后空白、空值、重复项目、表外项目） |
| `reference_ranges.csv` | `item,unit,ref_low,ref_high,critical_low,critical_high` | 参考区间与危急阈值（空列 = 该侧不判） |
| `patient.json` | `report_id,name,sex,age,collected_at,complaint` | 虚构患者信息 |

| case | 规模 | 特点 |
|---|---|---|
| case01 | 报告单 15 行 → 13 项（12 可判定 + 1 表外） | 含 3 个危急值、2 个**恰好等于边界**的项 |
| case02 | 报告单 19 行 → 16 项（15 可判定 + 1 表外） | 更大批量，含"重复行里第二条更严重"的陷阱 |

## 判据设计要点

1. **两处边界口径方向相反，是刻意设计**：`flag` 用**严格不等**（恰好等于参考上限 → `normal`）、
   危急值用**闭区间**（恰好等于危急阈值 → 报警，安全侧）。这一组对照把"算数必须交给脚本、
   不能让模型凭感觉判"变成了硬性判据（`LDL` 3.4 与 `K` 6.2 都在 case 里）。
2. **"不确定就说不确定"是判据**：参考区间表里没有的项目必须判 `unknown`（`ref_low`/`ref_high`
   为 `null`、进 `unknown_items`），**猜成 normal/high 就过不了**。这是医疗场景的安全底线，
   也是本章"description 要写清不适用场景"的同一件事。
3. **"拦截"落成可检验的交付物**：平台没有 hooks 运行时，所以正文里的「危急值强制提示」
   落成 **`critical_alerts`（每条要写出依据阈值）+ `summary` 里的就医提示**；
   另有一条语义项判"有没有越界下诊断"（写"这是糖尿病"→ 不通过）。
4. **`skill_card` 把 SKILL.md 的"脸面"带进报告**：`description` 是模型的触发路由
   （解决什么 / 什么触发 / **不适用**），judge 专门判它是不是宣传语；`safety_rules` 判安全边界。
5. **口径钉死 → 逐字段可比**：清洗 5 条 + 判定 2 条都写进 `task.md`，所以逐项 `flag`、危急值名单、
   丢弃计数、`unknown` 名单全是唯一确定的，`assertions` 逐条比对（不需要"达标线"）。

### 出题时的实测依据（不是推测，2026-10-10 在本机复验镜像里跑）

| case | 报告单行数 | 判定项 | 丢弃（非法/重复） | 危急值 | 恰好等于边界的项 |
|---|---|---|---|---|---|
| case01 | 15 | 13（12 可判定 + `BIL-T` 表外） | 1 / 1 | 3（`K` 6.2、`PLT` 28、`WBC` 1.2） | `LDL` 3.4（=上限）、`TSH` 4.94（=上限） |
| case02 | 19 | 16（15 可判定 + `FERR` 表外） | 1 / 2 | 3（`CA` 1.55、`CREA` 560、`GLU` 26.0） | `K` 3.5（=下限）、`TSH` 0.35（=下限）、`WBC` 9.5（=上限） |

参考实现复验：**2/2 case 通过、硬性断言 12/12**，单轮 dsh 68s / 55s（`VERIFY_REASONING_EFFORT=low`）。
`--check` 退出码 0（依赖：`matplotlib`，镜像已预装）。

## 项目字段文案（上传到平台时用）

**objectives**

1. 说清 Skill 与"一段更长的提示词"的区别：Skill 是可复用、可维护、可度量的工作流封装，
   `description` 是它的触发路由 —— 要写清"解决什么、什么触发、**什么场景不适用**"。
2. 能把"确定性任务下沉给脚本"落成代码：数值与参考区间的比较交给程序，模型只负责把结论讲清楚。
3. 能说清医疗类 Skill 的安全边界：危急值必须被突出提示，全程不下诊断结论 —— 而且这些边界
   要能被检验，不能只写在文档里。

**background**

- **Skill = 写给 Agent 的"临床路径"**：`SKILL.md`（触发规则 / 执行步骤 / 输出规范）加上
  `scripts/`（确定性计算）、`references/`（知识文档）、`assets/`（模板）等资源。
- **渐进式披露**：平时只看到一行简介 → 命中触发条件才读 `SKILL.md` → 用到哪一步才加载哪一步的资源。
- **`description` 不是宣传语**，而是模型决定"用不用这个技能"的依据：写清触发与不适用场景。
- **确定性任务下沉**：大模型算数不稳（尤其"恰好等于阈值"这类边界），比较、统计、格式化都应该交给脚本。
- **危急值（critical value）**：如血钾 ≥ 6.2 mmol/L 这类结果必须尽快处理 —— 医疗类 Skill 要让它在
  交付物里**显式出现**，而不是淹没在清单里。
- **安全边界**：只描述"数值与参考区间的关系"，不给诊断、不给用药建议。
- 本课程平台**没有 hooks 运行时**（那是平台能力，不是 Skill 能自带的东西），所以本实验把正文里的
  "hooks 拦截"落成 **`critical_alerts` + `summary` 的就医提示** —— 一样可以被检验。

**description**（导学步骤）

1. 读 `task.md`：先看清**清洗口径**与**判定口径**（注意两处不等号方向不同），再去看交付格式。
2. 读 `problem/reference/`：一份走完六步的示范 —— 先读懂它的输出，再写你自己的。
3. **先摸清材料**：报告单只有 `item/value/unit`，判定依据全在 `reference_ranges.csv` 里。
4. **清洗归一**：全角转半角（NFKC）→ 去首尾空白 → 丢空值/非数字行 → 同一项目只留**首次**出现。
5. **逐项比对**：`flag` 用严格不等、危急值用闭区间；区间表里没有的项目判 `unknown`，**不许猜**。
6. **组织 `skill_card`**：`description` 写清触发与不适用场景；`safety_rules` 写清危急值怎么处理。
7. **画图 + 写结论**：把每项相对参考区间的偏离画成一张图（标题轴标签用英文），
   `summary` 给就医提示且不下诊断；把踩过的坑写进 `SKILL.md` 的「实测档案」。
8. **自测两个 case**：与 `cases/<case>/expected.json` 对照（逐项 `flag`、危急值名单、丢弃计数）。

**references**

- 课程第 18 章《技能 Skill 的创建与使用》（Skill 的定义、渐进式披露、`description` 触发路由、hooks）
- 本课程的 Skill 模板与题目包规范：`docs/EXPERIMENT-PACKAGE-SPEC.md`
- 参考区间（reference range）与危急值的通用概念：
  <https://en.wikipedia.org/wiki/Reference_range>
- 关于"不要让语言模型算数"的常见工程实践：把比较与统计下沉到脚本（本课程第 3 章、第 4 章反复强调）

**faq**

- **恰好等于参考上限，判正常还是偏高？** 判 `normal` —— `flag` 的口径是**严格不等**
  （`value > ref_high` 才算高）；参考区间是"参考范围"，端点在内。
- **恰好等于危急阈值，要不要报警？** 要 —— 危急值用**闭区间**（`value >= critical_high` 或
  `value <= critical_low`），宁可多提醒，不可漏。
- **参考区间表里没有这个项目怎么办？** 判 `unknown`（`ref_low`/`ref_high` 写 `null`，项目名进
  `unknown_items`），**不许猜一个正常或异常** —— 在真实场景里"说不确定"远好过"猜"。
- **同一个项目出现两次怎么处理？** 只保留**首次**出现（后面的整行丢弃，计数进
  `dropped.duplicates`）—— 哪怕后面那条更严重也不例外，否则结果就不唯一了。
- **图里的中文变成方框？** 运行环境没有中文字体：图的标题/轴标签用英文，中文写在
  `takeaway` / `summary` / `notes` 里。

## 打包 / 自检 / 上传

```sh
cd server/fixtures/lab-report-reader
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构与依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧闭环：拿参考实现跑一遍复验（应 2/2 通过）
docker run --rm --env-file ../../../server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low \
  -v "$PWD:/p:ro" -v "$PWD/../../../.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/lab-report-reader.json --timeout-ms 300000
```

上传两个 ZIP 拿 `fileId`，在项目里绑到「Skill 模板」「题目包」两个位置，再用 `chapterId` 挂到
课程《分子医学人工智能理论与实验》**第 18 章《技能 Skill 的创建与使用》**下并 publish
（命令见 `docs/EXPERIMENT-CREATION-GUIDE.md` 步骤 11）。
