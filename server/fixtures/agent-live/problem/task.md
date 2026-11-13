# 应用实验：搭一个能跑的通用 agent

> **这是搭建型任务**：交付一个**真的会自己干活**的 agent —— 它自己调模型、自己决定下一步、
> 自己调工具、自己记住你说过的话。
>
> **没有标准答案**：平台不做"和参考答案逐字段比对"。机器只做**冒烟检查**（产物齐不齐、
> 是不是真的调了模型、工具是不是真的跑了、引用有没有依据），**完成质量由教师按 `judge.md`
> 的 rubric 打分**。

## 场景（只有这一个）

设备维护班组要一个助手：能查设备台账、按手册算保养逾期、查维护要求，并且**不乱下结论**。

材料就在当前目录：

| 文件 | 是什么 |
|---|---|
| `assets.csv` | 设备台账 11 台（`asset_id` / `name` / `site`（A 区 / B 区 / C 区）/ `location` / `model` / `installed_on` / `last_service_on` / `status`） |
| `kb/KB-0N.md` | 维护手册 5 篇（保养周期 / 滤芯 / 异响 / 安全禁令） |
| `tools.json` | 三个工具的名册与参数（**工具要你自己实现，真读上面两份材料**） |
| `limits.json` | 限额：每轮步数上限、检索取前几条、记忆窗口、判定基准日、各类设备的保养周期 |
| `tasks/T*.jsonl` | 6 组真实对话（每组 2-3 轮），你的 agent 要一组一组跑完 |

## 你要改的文件

```
agent/loop.py      ← 循环：问模型 → 解析动作 → 执行 → 观察 → 再问（**核心**）
agent/tools.py     ← 三个工具：query_assets / overdue_assets / search_manual
agent/memory.py    ← 跨轮记忆：写入 / 应用 / 更正
scripts/run.py     ← 已给好，不用改：遍历 tasks → 写 output.json → 画图
agent/llm.py       ← 已给好，不用改：模型客户端（重试 + token 记账；发布后会自己改走平台代理）
agent/api.py       ← 已给好，不用改：平台入口，把 run_dialogue() 接到对话请求上
agent/profile.json ← agent 的定制：名字 / 语气 / 签名 / 禁语
report.md          ← 过程记录
```

## 六件硬要求

1. **真的调模型（不许写死输出）**
   模型地址与密钥从环境变量取：`DEEPSEEK_API_KEY`（必需）、`AGENT_LLM_BASE_URL`（可选，
   默认 `https://api.deepseek.com`）、`AGENT_LLM_MODEL`（可选，默认 `deepseek-flash`）。
   `agent/llm.py` 已经封装好，直接用。**平台会核对 `output.json` 里的模型调用记录**：
   一次调用都没有，这份产出一律按未完成处理。
2. **循环**
   每一轮：模型返回一个 JSON 动作，你执行它，把**观察**写回消息列表，再问模型 ——
   直到模型说 `finish` 或步数到 `limits.json` 的 `max_steps_per_turn`。
   每个动作都要进 `steps`，含 `observation`（工具结果或被截断的原因）。
3. **工具（真读文件）**
   按 `tools.json` 的名册实现三个工具。返回结构自定，但必须来自 `assets.csv` / `kb/` 的**真实内容**：
   把返回值写死成常量，教师抽查时一眼能看出来（rubric 里有一项叫"工具是真的"）。
4. **记忆**
   用户说过的事实（"我负责 A 区"）要能跨轮用上；用户**更正**（"其实我负责 B 区"）后，
   旧事实要被替换，不能继续按 A 区回答。记忆状态写进 `memory`。
5. **边界**
   `KB-05` 规定：设备剩余寿命、能不能继续用，**远程不得给结论**。
   遇到这类请求（`T6` 第 1 轮）必须拒答，并把话题引回"能查的"（保养记录 + 手册要求）。
6. **出处**
   引用手册时给出**段落编号**（文件名去掉 `.md`，如 `KB-03`），且该编号必须真的出现在
   你这一轮 `search_manual` 的返回里 —— 编一个编号出来会被判为"引用无据"。

## 怎么跑

```sh
cd <你的 skill 根>
python3 scripts/run.py --tasks <题目包>/tasks --out output.json
```

`run.py` 会按文件名顺序跑完 6 组对话，每轮调用你的 `run_dialogue()`，
最后写出 `output.json` 并画一张图到 `figures/`。

> **复验就是这样跑的**：平台把材料拷进工作目录、你的 skill 拷成 `skill/`，
> 然后直接执行 `python3 skill/scripts/run.py --tasks ./tasks --out output.json`。
> 所以这条命令必须能在干净目录里跑通 —— 不依赖你本地的路径、环境变量之外的东西。

> 调试建议：先只跑一组 `--only T1_lookup`，把循环调通，再看别的组。

## 交付格式（`output.json`）

```json
{
  "agent": { "name": "…", "model": "deepseek-flash", "max_steps_per_turn": 4 },
  "llm": { "total_calls": 26, "calls": [ { "dialogue": "T1_lookup", "turn": 1, "model": "…",
                                         "prompt_tokens": 812, "completion_tokens": 96, "latency_ms": 1430 } ] },
  "dialogues": [
    {
      "task": "T1_lookup",
      "terminated": ["done", "done"],
      "turns": [
        { "turn": 1, "user": "…", "steps": [ { "step": 1, "action": "tool", "tool": "query_assets",
                                              "args": { "site": "A 区" }, "observation": "…" } ],
          "answer": "…", "citations": ["KB-01"], "refused": false }
      ],
      "memory": { "entries": [ { "key": "site", "value": "A 区", "state": "active" } ], "applied": [ { "turn": 2, "key": "site" } ] }
    }
  ],
  "metrics": { "dialogues": 6, "turns": 14, "tool_calls": 11, "tool_errors": 0, "llm_calls": 26, "refusals": 1 },
  "figures": [ { "name": "figures/tools_by_dialogue.png", "takeaway": "…" } ],
  "notes": "…（≥80 字：你的循环怎么收敛、记忆为什么这么设计、哪一步最容易出错、还有什么局限）"
}
```

## 做完之后：让它真的能用（约 10 分钟）

跑完 6 组只证明"它能转"；这一节让它变成**别人能对话的东西**（不算第 20 章那份正式应用，
但你现在就能用起来）。

1. **把数据拷进 Skill 根**（发布时数据要跟着 agent 一起走）：

   ```sh
   cp <题目包>/assets.csv <题目包>/limits.json <题目包>/tools.json .
   cp -r <题目包>/kb .
   ```

2. **确认包里有 `agent/api.py`** —— 已经给好了，不用改：它把你的 `run_dialogue()` 接到平台的
   对话请求上（一次喂一条消息），记忆条目表存在平台的会话里，所以第 2 句还认得第 1 句。

3. **打成 zip 提交**，然后在平台左侧「我的应用」里点 **用我的 Skill 创建应用**；
   平台会给你一个应用地址和一条**分享链接**（发给别人，免登录也能打开）。

4. 打开应用，试着连着说两句：`我负责 A 区` → `我们区有哪些设备该保养了`——
   它应该只报 A 区的设备。这就证明你的 agent 不只是"能跑批"，而是**真的在被用**。

> 应用容器里**没有模型 key**：`agent/llm.py` 会自动改走平台的模型代理（工作台里仍是直连）。
> 所以你什么都不用配。

## 交付前自检

- [ ] `python3 scripts/run.py --tasks tasks --out output.json` 能跑完 6 组，不抛异常；
- [ ] `output.json` 的 `llm.total_calls` 大于 0，且每条 call 的 `latency_ms` 是真实耗时；
- [ ] `metrics.tool_calls` 大于 0：工具真的被调用了，不是把答案写死；
- [ ] `T3` 第 2 轮用上了"A 区"；`T4` 第 3 轮按 B 区回答（更正生效）；
- [ ] `T6` 第 1 轮 `refused=true` 且 `citations=[]`；
- [ ] 每条 `citations` 里的编号，都能在本轮 `search_manual` 的 `observation` 里找到；
- [ ] `figures/` 有一张图，`notes`（写在 SKILL 根的 `notes.md`，≥80 字）讲了取舍与局限；
- [ ] `report.md` 写了自测时间与至少一条踩坑；
- [ ] （可选）已按上面的步骤发布成应用，并自己对话试过两轮。

## 评分

| 谁 | 判什么 |
|---|---|
| 平台（自动） | 冒烟：字段齐 / 真调了模型 / 工具计数自洽 / 引用有据 / 拒答轮无引用 / 图与 notes 在 |
| 教师（rubric） | `judge.md` 四维：任务完成度 40 / agent 循环设计 25 / 工具与记忆的真实性 20 / 报告与边界 15 |

> 机器分只是**建议分**，教师分可以覆盖它。
