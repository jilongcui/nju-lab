---
name: agent-app-report-reference
description: 参考实现（随题包下发）：三类附件 → 四节报告 + 指标表，先读后仿。
---

# 参考实现（先读后仿）

这一档（**容易**）给示范。三个文件：

| 文件 | 作用 |
|---|---|
| `harness/api.py` | 你要写的两个函数：`parse_attachment()`（三类附件 → 指标行）与 `build_report()`（四节 + 指标表 + 计数） |
| `harness/run.py` | 胶水（不用改）：读附件与模板 → 调你的函数 → 写 `output.json` + 图 |
| `app_host.py` | 宿主（不用改）：图片视觉调用走**平台模型代理**（容器里没有 key），本地自测回退直连 |

## 关键点（三句话）

1. **PDF / Word 自己解**：环境里没有 `pypdf` / `python-docx` —— PDF 抽 `(...) Tj`、DOCX 解 zip 读 `<w:t>`；
2. **图片只能走视觉**：没有文本层，交给 `app_host.vision_extract()`；它的输出格式会漂，所以下游要用容错正则抽行；
3. **报告要能逐行核对**：四节 + 指标表 + `flag`（由参考区间判），不是一段散文。

## 运行

```sh
python3 skill/harness/run.py . output.json      # 复验环境（当前目录就是 case 输入）
python3 harness/run.py <case目录> /tmp/x.json   # 本地
```
