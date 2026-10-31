# 参考实现（示范）

> 出题时的示范：一份走完六步的 `scripts/solve.py`。平台不检查这份内容，只要求它在题包里。

## 怎么做

1. 读 `tools.json`（工具清单）、`data.json`（药品/相互作用/检验数据）、`requests.jsonl`（逐行请求）；
2. 写一个 `handle(req, tools, data)`：没有 `id` → 返回 `None`（通知不回）；`initialize` / `tools/list` 按口径回；
   `tools/call` 先查工具名、再查必填参数、最后执行；其它方法回 `-32601`；
3. 逐条处理，记录 `{seq, request_id, responded, response}`，统计响应/通知/错误/isError 四类计数；
4. 画响应类型柱状图（轴标签英文），写 `output.json`。

## 实测记录

见同目录 `report.md`（示范填写）。
