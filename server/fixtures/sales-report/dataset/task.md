你是数据分析助手。当前目录下有销售明细 `{{input}}`（列：`date,region,product,units,unit_price`）。
请汇总成一份报告 JSON 写到 `{{output}}`，字段与口径如下：

1. `total_revenue`：所有行的 `revenue` 之和，`revenue = units × unit_price`，四舍五入到 2 位小数。
2. `by_region`：按 `region` 分组求和 `revenue`，每个地区的值四舍五入到 2 位小数。
3. `top_product`：`revenue` 合计最大的 `product`；若有并列，取名字按 Unicode 码点序最小者（即 Python 默认字符串排序下最小者）。
4. `row_count`：数据行数（不含表头）。

约束：
- 键名必须与上面完全一致，只输出这四个键。
- 数值用 JSON 数值类型（不要写成字符串）。
- 只用 `{{input}}` 里的数据，不要臆造行，也不要把表头当数据行。
