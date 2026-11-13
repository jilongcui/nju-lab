# agent-live —— 第 19 章：搭一个能跑的通用 agent

> **单场景包**（规范见 `docs/EXPERIMENT-PACKAGE-SPEC.md` §3.0）：没有 `cases/`、没有 `expected.*`，
> 判据是**冒烟 + 自洽 + 防退化**，成绩以 `judge.md` 的教师 rubric 为主。

## 为什么是这个形态（2026-11-15 重构）

上一版 `harness-agent` 把"通用 agent"做成了"填 12 个函数、让 `output.json` 等于 `expected.json`"：
模型被换成 `plan_stub.json` 桩，学生写的是按剧本执行的记账器，16 条断言里 11 条要求逐字段对齐标准答案。
**那考的是"照文档实现"，不是"搭 agent"** —— 而且两个 `case01/case02` 的形态照搬了机器学习实验的对照范式。

这一版改掉三件事：

| 改掉 | 改成 |
|---|---|
| 模型是桩（`plan_stub.json`） | **真调模型**（`DEEPSEEK_API_KEY`，平台工作台与复验容器都透传） |
| `expected.json` 逐字段比对 | **冒烟断言**（真调了模型 / 工具真跑 / 引用有据 / 计数一致）+ **教师 rubric** |
| 两个 case 对照"通用性" | **一个场景、6 组真实对话任务**（`tasks/T*.jsonl`），看它能不能真把事情办成 |

## 目录

```
problem/            → problem.zip（下发）
  manifest.json     15 条冒烟断言；outputFile=output.json；无 expected
  task.md           题干：一个场景 + 六件硬要求 + 怎么跑 + 交付格式
  judge.md          教师 rubric（任务完成度 40 / 循环 25 / 真实性 20 / 报告与边界 15）
  README.md         导学 + 排错表
  assets.csv        设备台账 11 台（site + location 两列）
  tools.json        三个工具名册（query_assets / overdue_assets / search_manual）
  limits.json       步数上限 / top_k / 记忆窗口 / 基准日 / 保养周期 / 拒答话术
  kb/KB-0{1..5}.md  维护手册 5 篇（文件名即段落编号）
  tasks/T*.jsonl    6 组对话：lookup / overdue / memory / correct / manual / refuse
skill-template/     → skill-template.zip（学生起点）
  SKILL.md  report.md  notes.md?（学生自己建）
  agent/llm.py      ✅ 给好：模型客户端（重试 + token 记账 + 调用日志）
  agent/data.py     ✅ 给好：读题目包
  agent/profile.json✅ 给好：定制（名字 / 语气 / 签名 / 禁语）
  agent/api.py      ✅ 给好：**平台入口**，把 run_dialogue() 接到对话请求上（发布成应用用）
  agent/loop.py     TODO：build_system_prompt / update_memory / run_dialogue
  agent/tools.py    TODO：三个工具（真读文件）
  agent/memory.py   TODO：write / correct
  scripts/run.py    ✅ 给好：跑完 6 组 → output.json + 图
solution/           ⚠️ 教师侧参考实现（不下发、不打包）
tools/              造题与校验脚本（不下发）
```

## 本地验证（教师）

```sh
cd server/fixtures/agent-live
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 1) 结构 + 依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg10 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 2) 完整复验：把 solution 当学生 Skill 跑一遍（真模型 + 断言 + judge）
cd /home/ubuntu/nju-lab
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low \
  -v "$PWD/server/fixtures/agent-live:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg10 --skill /p/solution --problem /p/problem.zip \
  --out /outputs/agent-live.json --timeout-ms 600000
```

**镜像要求**：`nju-lab-verify:0.2.0-rc.2-pkg10` 及以后。
- pkg9 = pkg8 + 支持"`expected` 可选 / 无 `cases/` 目录"的驱动；
- pkg10 = pkg9 + 支持 `runMode: "script"`（本包用它，见下）。

### 为什么用 `runMode: "script"`

包里的 `manifest.json` 声明了：

```json
"runMode": "script",
"runCommand": "python3 skill/scripts/run.py --tasks ./tasks --out output.json"
```

复验直接执行这条命令，**不让被测 dsh agent 代劳**。实测对比（同一份 solution）：

| 模式 | 结果 |
|---|---|
| `dsh`（默认） | 293 秒；dsh 把题干当成"实现任务"，改完代码却没运行它 → `output.json` 缺失，判为不通过 |
| `script` | 45 秒；稳定产出 → 15/15 断言、judge 0.95 |

交付物本来就是一段可执行程序时，判分就执行它 —— 这也省掉一层"agent 套 agent"的浪费。

## 实测（2026-11-15，pkg9）

| 项 | 结果 |
|---|---|
| `--check` | 退出码 0；`cases=["main"]`、`expected=null`、`inputs` 5 项、依赖 ok |
| 参考实现直跑（镜像内 `run.py`） | 6 组 / 15 轮 / 17 次工具调用 / 32 次模型调用 / 1 次拒答 / ~48 秒 |
| 完整复验（pkg10，`runMode=script`） | **pass=true / score=0.95 / 15-15 断言 / 45 秒** |
| 断言 | **15/15** |
| 关键行为 | T4 更正后旧值 `superseded`、`active` 只剩 B 区；T6 第 1 轮拒答且 `citations=[]`；T2 逾期最长 C-01 625 天 |

## 做完之后能用起来：发布成应用（零平台改动）

学生跑完 6 组只证明"它能转"。要让它**被对话使用**，走平台已有的应用托管：

```
学生 Skill 包（含 agent/api.py + agent/ + 数据）
  → 提交 → 「我的应用」点"用我的 Skill 创建应用"
  → 平台起 nju-lab-app-runtime 容器
  → entrypoint 判定：包里没有 harness/api.py → **skill 模式**（平台 harness + 学生包当 core）
  → app_host.find_entry() 第一候选就是 skill/agent/api.py  ← 学生的 agent
  → 网页对话 / 分享链接（免登录）/ 教师可看对话记录
```

**为什么不用改平台**：`app_host.py` 的 `ENTRY_CANDIDATES` 第一项本来就是 `agent/api.py`
（第 19 章的 agent），`entrypoint.sh` 与 `detectEntry` 也都认。之前只是新包没提供这个文件。

关键实现（都给学生给好，学生不改）：

| 文件 | 作用 |
|---|---|
| `agent/api.py` | `handle(state, message, attachments, session)` → 一次喂一条消息给 `run_dialogue()`；记忆条目表存进 `session`，所以第 2 句认得第 1 句 |
| `agent/llm.py` | 应用容器里**没有模型 key**：检测到 `APP_LLM_BASE_URL` + `APP_LLM_TOKEN` 就改走平台代理（`POST {base}/chat`，头 `X-App-Token`），工作台里仍直连 DeepSeek |
| 数据 | 学生把 `assets.csv` / `kb/` / `limits.json` / `tools.json` 拷到 Skill 根（task.md 有一条命令） |

实测（2026-11-15，`nju-lab-app-runtime:0.8.0` 起容器 + 容器 IP 直连）：

| 项 | 结果 |
|---|---|
| `/api/health` · `/api/app` | `{"ok":true}`；标题按 `APP_TITLE` 生效 |
| 第 1 轮 | 「这个月哪些设备该保养了」→ 5 台逾期，C-01 625 天 |
| 第 2 轮 | 「我负责 A 区」→ 已记下 |
| 第 3 轮 | 「我们区有哪些设备该保养了」→ **只报 A 区 2 台**（跨轮记忆在应用里也生效） |

> 注意：skill 模式下 `/work/app/app.json` 由 entrypoint 生成（标题取应用标题、附件固定
> pdf/docx/image），学生包里的 `app.json` **不生效**，所以包内不再放它。

## 已知坑（做这一类包时会踩）

1. **台账字段要和任务里说的话对得上**：最初 `site` 写"A 区车间"、任务说"我负责 A 区"，
   精确匹配全空，`overdue_assets(site=…)` 恒返回空 —— 拆成 `site` + `location` 两列。
2. **`parse_action` 只取第一个完整 JSON**：模型会一口气输出两个动作，用"第一个 `{` 到最后一个 `}`"
   会解析失败并把整段 JSON 当答案（`json.JSONDecoder.raw_decode`）。
3. **拒答判定不能松**：用"回答里出现不能"会把解释边界的正常轮次误判成拒答，触发"拒答轮不得有引用"。
   要判"用户要寿命结论 **且** 回答明确拒绝"。
4. 容器内跑 `run.py` 会以 `nobody` 身份在 `solution/figures/` 落图，宿主机删不掉 —— 清理要进容器：
   `docker run --rm -v "$PWD/solution:/p" --entrypoint sh nju-lab-verify:... -c 'rm -rf /p/figures'`。
