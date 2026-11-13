---
name: lab-report-reference
description: 参考 Skill（随包下发）：把平台解析好的附件整理成四节报告 + 指标表 + 越界提示。
---

# 参考 Skill（先读后仿）

平台已经把附件解析好（`attachments[].rows`），参考实现只做业务判断与成文：

| 文件 | 作用 |
|---|---|
| `scripts/api.py` | `handle()`：判 flag → 写四节报告 → 记忆偏好 → 越界升级 |
| `report_format.json` | 四节模板 / 参考区间 / 固定话术 |
| `run_case.py` + `platform_core.py` | 本地自测（与平台同一套解析与记忆逻辑） |

运行：`python3 run_case.py <case目录> output.json`（复验环境里当前目录就是 case 输入）。
