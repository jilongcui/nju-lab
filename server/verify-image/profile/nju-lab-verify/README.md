# nju-lab-verify profile

平台**复验**用的一次性运行形态：`dsh-base` + `dsh-headless`，`approval=never`。

## 用法（在一次性容器内）

```sh
export DSH_HOME=/opt/nju-verify/.dsh
cp -r nju-lab-verify "$DSH_HOME/profiles/nju-lab-verify"

# 解包学生 Skill → 用题目包跑复验（题干 + Skill 一轮；驱动见 server/verify-image/run-eval.mjs）
dsh --profile nju-lab-verify "run the skill against the problem package"
```

## 实测契约（0.1.5-rc.2，2026-09-21 实测，修正设计文档 §7 的推断）

- task 只能是位置参数（多词自动拼接）；**不支持** stdin（`-` 被当作字面任务），
  **没有** `--json`（unknown option，exit 1）。
- stdout：最终 assistant 文本 + 换行；无 assistant message 时打印空行且 exit 1。
- stderr：`dsh: reasoning:` 段（模型 reasoning 流）；失败时 `dsh: <code>: <message>`
  （如 `dsh: MISSING_CREDENTIAL: ...`）。
- 退出码：0 = `turn/end` completed；1 = 中止/报错/无 turn/用法错误。
- token 用量不在 stdout/stderr，需读 `$DSH_HOME/sessions/<cwd-slug>/<session-id>/session.v3.jsonl.zstd`
  （zstd 压缩 JSONL，`"usage"` 对象；驱动脚本 run-eval.mjs 已实现提取）。
- 结构化事件流的替代：session 日志本身即完整事件记录（含 tool_call/tool_result/usage）。

## 实测修正的 patch 字段（cordis.patch.yml 内注释有完整记录）

- `approval`（不是 `user-approval`）+ `sandbox-policy`：id 与字段名实测正确。
- `permission`（dsh-permission-presets）：workspace-write + approval=never 不匹配任何
  内置预设，**必须**显式声明 `verify` 预设并钉 `defaultPreset: verify`，否则启动即失败。
- patch 的 config 是**整段替换**，不是深合并（presets 表需全量重写）。
- 模型路由：`llm-deepseek` 配 `apiKeyEnv` + `baseURL` 可指向任意 OpenAI 兼容端点
  （PoC 用 Moonshot `kimi-k2.6`）；换回 DeepSeek 官方见 patch 文件注释。

## 容器要求（nju-lab-craft.md §6.4 / §7）

- **断网**（DSH 沙箱不挡网络，容器是唯一信任边界）
- CPU / 内存 / 时长 / token 资源限额（headless 无内建轮数上限，靠容器 timeout）
- `approval=never`（本 profile 已设）
- `DSH_TELEMETRY_DISABLED=1`（默认 exporter 指向 deepseeksvc.com，复验容器应关）
- 平台自带 profile + 基础镜像，**不读学生本地 profile**

> 学生 Skill 的 `scripts/` 是任意代码——只在容器里跑。
