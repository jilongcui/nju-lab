# AGENTS.md

本仓库的 agent 操作约定。

## 升级 / 部署 DSH —— 先读 playbook

升级 `@deepseek-ai/dsh`、重建镜像、部署、重打学生 kit 的**完整流程与本机约束**见
[`docs/UPGRADE-playbook.md`](docs/UPGRADE-playbook.md)。**动手前先读它**，特别是其中
「§4 已知坑」：前端协议路径（`__DSH_TRANSPORT__` / WS 404）、历史文档勿改、沙箱不能 sudo、
`node:22.23.2-slim` 拉不到、`zip`/`unzip` 需自装、L2 测试必须带 `DSH_BIN`。

## 导航

- 运行态事实、服务与部署现状：`HANDOFF.md`
- **出题教师**：实验设计框架 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md`、实验包规范 `docs/EXPERIMENT-PACKAGE-SPEC.md`
- 客户端设计：`nju-lab-client-design.md`；其他设计：`docs/DESIGN-*.md`
- 验收记录：`docs/ACCEPTANCE-*.md`（**历史快照，勿改**）
- 本地构件（插件 / profile / kit）：`dsh/`
- 示例实验包（可直接复制改名）：`server/fixtures/`（`ml-basics` / `sales-report` / `csv-cleaner`）
- 项目 skill（可复用的 agent 操作，如更新课程章节正文）：`.kimi-code/skills/`

## 纪律

- 所有改动先提交再 push 到 `origin`；**禁止直接在部署目录改代码**（部署目录 = 仓库子目录 `server/`）。
- 带日期的实测记录、历史验收文档、已存在的镜像制品名：**保留原版本号**，不要跟着版本升级改。
