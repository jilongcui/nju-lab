# 入门实验：手写一次 MCP 往返（工具协议 · 容易）

> **流程归属（给引导用的提示）**：本实验是**工程实现型**——按题目口径写一段确定性代码、
> 用两个 case 逐字段核对，**没有"定基线 → 训练 → 评估指标"这些环节**。六步见下面「实验流程」，
> 第 3 步是"按口径写实现"，第 5 步是"边界用例自测"，不要拿机器学习的流程来带。

## 业务背景

医生问"P001 最近几次 HbA1c 多少"，裸模型只能背课本 —— 它拿不到检验库。要让智能体"查得到"，
就得给它一个**工具**。MCP（Model Context Protocol）规定了"怎么问工具、怎么答"的统一格式：
一次调用三步 —— `initialize` 握手 → `tools/list` 问清单（含 `inputSchema` 说明书）→ `tools/call` 执行。

这个入门实验不装 SDK、不联网：**一行一条 JSON-RPC 报文**，你自己把服务器那一侧写出来。

## 你的任务

case 目录里有三个输入：

| 文件 | 内容 |
|---|---|
| `tools.json` | 工具清单（`name` / `description` / `inputSchema`），case01 两个、case02 三个 |
| `data.json` | 药品库、相互作用表（case02 还多一张检验表） |
| `requests.jsonl` | 每行一个 JSON-RPC 请求（含一条**通知**） |

按顺序处理每个请求，产出 `output.json`（每条请求一条记录），再画一张「响应类型」柱状图。

**响应口径（写死，错误码也算分）**

| 请求 | 响应 |
|---|---|
| 没有 `id` 的通知（如 `notifications/initialized`） | **不产生响应**（`responded: false`，`response: null`） |
| `initialize` | `result: {protocolVersion:"2024-11-05", capabilities:{tools:{}}, serverInfo:{name:"drug-info", version:"0.1"}}` |
| `tools/list` | `result: {tools: <tools.json 里的数组，原样>}` |
| `tools/call` 且工具名存在、必填参数齐 | `result: {content:[{type:"text", text: <查询结果>}], isError: <bool>}` |
| 查不到（药品/组合/检验） | 照样是 `result`，但 `text` 写 `未收录…` 且 `isError: true` |
| 工具名不存在 | `error: {code:-32602, message:"未知工具 <name>"}` |
| 缺必填参数（按 `inputSchema.required` 的第一个缺失项） | `error: {code:-32602, message:"缺少必填参数 <param>"}` |
| 其它未知方法 | `error: {code:-32601, message:"不支持的方法 <method>"}` |

**工具返回文本（逐字对）**

- `get_drug_info`：`适应证：<indication>；禁忌证：<contraindication>。`；查不到 → `未收录该药品`
- `check_interaction`：把两个药名**按字典序排序后用 `|` 连接**去查表，命中 → `相互作用：<text>。`；
  查不到 → `未收录该相互作用组合`
- `query_labs`（只在 case02）：取该患者该项目**最后 `limit` 条**（默认 3），
  格式 `日期 值`，多条用 `；` 连接；查不到 → `未收录该检验记录`

## 实验流程（六步）

| 步 | 做什么 | 产出 |
|---|---|---|
| ① 看清需求 | 三类响应（result / error / 不响应）的边界、两种错误码 | 心里有数 |
| ② 看数据 | 工具有几个、`inputSchema.required` 是什么、请求里有没有通知和错误 | 心里有数 |
| ③ 写握手与清单 | `initialize`、`tools/list` | 前几条响应 |
| ④ 写调用 | 先查工具名 → 再查必填参数 → 再执行 | 工具结果 |
| ⑤ 收尾统计 | 响应/通知/错误各几条 | `stats` |
| ⑥ 写结论 | 为什么"查不到"不是错误、错误码为什么要分清 | `report.md` |

## 交付格式

**`output.json`**（写在工作目录下）：

```json
{
  "responses": [
    { "seq": 1, "request_id": 1, "responded": true,
      "response": { "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": "2024-11-05" } } },
    { "seq": 2, "request_id": null, "responded": false, "response": null }
  ],
  "discovered": { "tools": ["get_drug_info", "check_interaction"], "count": 2 },
  "stats": { "requests": 9, "responded": 8, "notified": 1, "errors": 3, "is_error_true": 1 },
  "figures": [{ "path": "figures/responses.png", "takeaway": "……（一句话：几成是正常回答、几条是错误）" }],
  "notes": "……（≥40 字：isError 与 error 的区别、错了会怎样）"
}
```

- `responses` 与 `requests.jsonl` **一一对应**（通知也要占一条记录，`responded:false`）；
- `seq` 从 1 开始；`request_id` 就是请求里的 `id`（通知为 `null`）。

## 怎么算完成（验收标准）

1. **两个 case 都跑通**：`responses` / `discovered` / `stats` 与 `cases/<case>/expected.json` **逐字段一致**；
2. **三处边界不能错**：
   - 通知**不产生响应**（`responded:false` 且 `response:null`）；
   - 查不到药/组合/检验是 `isError: true` 的**正常返回**，不是 `error`；
   - 工具名错/缺参数用 `-32602`，方法不认识用 `-32601` —— 不能混用；
3. case02 的 `discovered.tools` 必须**自动**多出 `query_labs`（这就是"加工具只改服务器"）；
4. 图能打开、`takeaway` 与 `stats` 自洽；
5. 结论与踩坑记下来——报告会由工具整理进 `report.md`，**不需要改 `SKILL.md`**。

判据全文见 `judge.md`。
