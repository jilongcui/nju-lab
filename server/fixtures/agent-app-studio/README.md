# 可分享的智能体应用（第 20 章 · 新增 · 收官）

> 课程《分子医学人工智能理论与实验》**第 20 章《综合实践：从 Harness 到可分享的智能体应用》**
> （2026-11 新增章节，`order = 20`）。
>
> 学生把第 19 章的 harness 接上**零依赖静态前端**，做成一个能给别人用的小应用：
> 上传 PDF / Word / 图片 → 解析成结构化指标 → 按口径生成报告 → **发布到平台、分享给老师、由教师管理**。
>
> 设计与里程碑见 [`docs/PLAN-2026-11-final-chapter-harness.md`](../../../docs/PLAN-2026-11-final-chapter-harness.md)；
> 平台侧（应用托管两期）见 [`docs/DESIGN-2026-11-agent-app-platform.md`](../../../docs/DESIGN-2026-11-agent-app-platform.md)。

## 结构

```
agent-app-studio/
├── problem/            → problem.zip        题目包（下发给学生；**没有 reference/**）
│   ├── manifest.json   IO 契约（flow=engineering）+ 16 条断言
│   ├── task.md         六步流程 + 解析/报告/记忆/前端分享的口径 + 交付格式
│   ├── judge.md        语义判据（为什么自己解附件 / 报告≠结论 / 记忆改变输出 / 局限）
│   ├── README.md       导学 + 排错表
│   └── cases/case0N/   requests / attachments（pdf+docx+png）/ report_format / limits /
│                       tools / tool_calls / plan_stub / template.json / kb/ + expected.json
├── skill-template/     → skill-template.zip 学生起点（含 `publish_app.py`：容器内一条命令交产物）
│   ├── SKILL.md / report.md
│   ├── app.json        元信息（标题/场景/入口/主题/附件类型/可见性 + 报告口径 `report`）
│   ├── app_host.py     应用宿主（**学生不改**；平台运行时用同一份）
│   ├── harness/run.py  胶水（**学生不改**；读 case → 调 core → 写 output.json）
│   ├── harness/api.py  **学生只改这个**：六个函数
│   └── web/            零依赖前端（index.html / theme.css / app.js）—— 学生必须改
├── solution/           ⚠️ 教师侧解答样例（不下发、不打包）：完整 core + 改过的 web/
├── tools/gen_cases.py  造题工具（生成 pdf/docx/png + 模板基线哈希，不下发）
└── README.md
```

## 学生怎么把产物交到平台（**可用性关键**）

学生的工作区在**远端容器**（dsh 工作台）里，浏览器拿不到那些文件 —— 所以"网页点上传"对学员
这条路是走不通的。题目包给了 `publish_app.py`：

```sh
python3 publish_app.py --app <应用 id>            # 打包（只打 app.json/harness/web/kb）+ 上传
python3 publish_app.py --app <应用 id> --publish  # 再发布，打印分享链接
```

它用工作台容器里已注入的 `NJU_LAB_SERVER_URL` / `NJU_LAB_TOKEN` 调平台接口（token 过期在平台
右上角「API Token」重领）。教师本地也能用同一脚本（手动 export 那两个变量即可）。
实测：17.0 KB 产物 → 版本 `47bbe998` → 发布 → 拿到 `shareKey`。

## 场景与口径（为什么这样出题）

"能跑通"和"能交付"是两件事：护士不会去命令行跑脚本，她要打开页面、拖进一份 PDF、说一句
"整理成报告"、拿到**能复核**的结果。所以这一章把三件新东西加进来：

| 新增 | 口径要点 | 判据落点 |
|---|---|---|
| **附件解析（两条通道）** | PDF 走未压缩内容流 + `Tj`（自己解）；DOCX 走 OOXML（`zipfile` + `<w:t>`，自己解）；**图片走视觉模型**（`deepseek-flash` 支持 `image_url`） | `attachments[].via` / `rows` / `chars` / `checksum` + `metrics.vision_calls` |
| **报告** | 四节名称与顺序照模板、`min_chars`；指标表按附件出现顺序逐行登记；`flag` 由参考区间判 | 节顺序 + 篇幅 + `metric_rows` 逐行 + `counts` |
| **记忆改变输出** | 「报告只列异常指标」生效 → 只列 `flag != normal`；「忘掉 MEM01」→ 恢复全量 | `report.counts.listed` + `memory.long` 三态 |
| **前端可交付** | `web/` 必须改过：`app.web_sha256` **不等于** `template.json` 的基线 | `app.web_sha256 != app.template_web_sha256` |

**为什么前端必须零依赖**：环境无外网、`npm install` 装不了任何东西；也没有 `pypdf` / `python-docx` ——
所以**解析附件本身就是题目的一部分**（"附件不是魔法"），不是调个库了事。
唯一的例外是图片：图片没有文本层，**只能走视觉模型**（实测 `deepseek-flash` 接受 `image_url`
且能准确读出三段式数据行）；判据因此只比对"抽出来的结构化行"，不比模型原始输出。

**防退化两端**：

| 偷懒解 | 被哪条拦住 |
|---|---|
| 不解析附件、直接把 PDF 文本贴进报告 | 指标表为空 / `flag` 无从判 → 逐行比对 fail |
| 直接交老师的 `web/` 模板 | `web_sha256 === template_web_sha256` → "前端真的改过" fail |
| 偏好不生效（报告按全量行出） | `counts.listed` 与 expected 不符（case01 应为 3，全量是 4） |

## 出题时的实测依据（2026-11-11，`nju-lab-verify:0.2.0-rc.2-pkg6`）

| case | 轮数/步数 | `terminated` | 工具 exec/rej | 指标行 total/abnormal/listed | 视觉（图片行 / checksum） | 记忆 | web 哈希（vs 模板） |
|---|---|---|---|---|---|---|---|
| case01 | 3 / 13 | 全 `done` | 1 / 1 | 5 / 4 / **4** | `HGB 88` low / `c482e7ae14a4` | active `MEM01` | `4fc2116779f23330` vs `f09358ec6ae858a5` |
| case02 | 3 / 12 | `done` / **`max_steps`** / `done` | 1 / 2 | 5 / 4 / **5** | `GLU 9.1` high / `e9cf731d3940` | forgotten `MEM01` | 同上 |

- **图片行真的进了指标表**：case01 的 `HGB 88`（low）、case02 的 `GLU 9.1`（high）；
- case01 偏好生效：`listed=4`（`HGB 142` 正常被过滤）；
- case02 第 3 轮忘掉偏好：`listed=5`（`HGB 145` 正常重新列出）—— **记忆真的改变输出**的行为性证据；
- case02 第 2 轮故意给 6 步（`max_steps=5`）→ 记 `max_steps`；
- **视觉稳定性**：同一张图连跑 3 次，图片 `checksum` 与 `trace_checksum` 完全一致（`PLT, 18, …` 与
  `PLT,18,…` 两种输出被容错正则归一，所以判据不会被空格差异打穿）。

**平台侧端到端实测**（2026-11-11，`nju-lab-app-runtime:0.1.0` + 临时实例 3101 端口）：

| 步骤 | 结果 |
|---|---|
| 上传 solution 的产物 zip | `sha256=fd80b7a0…`，版本落盘 `<数据根>/<appId>/<versionId>.zip` |
| 发布 / 起容器 | 容器 `nju-lab-app-…`（512m/0.3cpu，`--internal`，只读挂 zip） |
| `GET /site` | 返回注入 `<base href="/lab/api/apps/<id>/site/">` 的 HTML |
| `GET /site/theme.css` | 200 |
| `POST /api/chat`（带 `report.pdf`） | 回复 + `citations=[KB-01]` + `metric_rows=[PLT 18 low, WBC 12.5 high]` + 升级 2 条（Web 侧同样走视觉通道，传图即可） |
| 教师 `GET /courses/:id/apps` | 看到已发布应用 |
| `GET /apps/:id/messages` | 落库的 user/assistant 两条 |

## 自检与复验

```sh
cd server/fixtures/agent-app-studio
# ⚠️ 图片走视觉：造题 / regen-expected 要带模型额度（`--env-file server/.env`），复验容器自身有额度
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low -e VERIFY_MAX_CASES=0 \
  -v "$PWD/server/fixtures/agent-app-studio:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/solution --problem /p/problem.zip \
  --out /outputs/agent-app-studio.json --timeout-ms 480000
```

实测：`--check` 退出码 0（**17 条断言**、依赖齐）；复验 **2/2 通过**、两 case 硬性 **17/17**。

> ⚠️ 模板或 `web/` 改动之后要重跑 `python3 tools/gen_cases.py`（它会把模板基线哈希写进
> `cases/*/template.json`，并重算 `expected.json` 用到的输入）。改动 `harness/api.py` 的解析口径
> 则要重跑 `--regen-expected`（**必须与复验同一个镜像**）。

## 项目字段文案（建项目时用）

- **title**：综合实践：把 harness 做成一个可分享的智能体应用（附件 → 报告 + 前端）
- **difficulty**：`hard`
- **content**（学生详情页首屏）：
  > 上一章你写的是 harness；这一章把它做成**科室里能直接用的小工具**：
  > 上传 PDF / Word / 照片 → 生成一份能复核的报告 → 有页面、能改主题、能发给老师用。
- **objectives**：自己解析三种附件；把报告口径钉死到逐行可复核；用记忆改变输出；
  守住安全边界；把前端改到"是你的应用"并发布分享。
- **background**：环境无外网、无 `pypdf`/`python-docx`，所以附件解析自己写；
  前端是零依赖模板改的；发布与分享由平台托管容器提供。
- **description**：六步流程；③ 搭 core + 改前端 ④ 逐轮核对 ⑤ 边界与分享自测（截断轮 / 忘掉偏好 /
> 拒答 / `web_sha256`）。
- **evalConfig**：`{model: "deepseek-flash", reasoningEffort: "low", timeoutSeconds: 900}`
- **rubric**：复验通过率 40 / 交付形态（前端改过 + 元信息齐全 + 能发布）25 /
  边界与踩坑记录 20 / 语义判据 15
