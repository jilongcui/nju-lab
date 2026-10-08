# 标准测试数据集：销售数据汇总（v1.0.0）

3 个用例，每个目录下 `input.csv`（销售明细）+ `expected.json`（汇总后期望产出）。

## 输入列

`date,region,product,units,unit_price`

## 汇总口径（评分以 `expected.json` 为准，逐字段容差见 `judge.md`）

1. `revenue = units × unit_price`（单行）
2. `total_revenue`：全部行 `revenue` 之和，四舍五入 2 位小数
3. `by_region`：按 `region` 分组求和，各自四舍五入 2 位小数
4. `top_product`：`revenue` 合计最大的 `product`；并列取名字 Unicode 码点序最小者（case02 专测并列）
5. `row_count`：数据行数（不含表头）

## 用例覆盖

| case | 测什么 |
|---|---|
| case01 | 基础汇总：三地区、三产品、正常小数 |
| case02 | `top_product` 并列（Alpha 与 Beta 同为 20.00 → 期望 Alpha） |
| case03 | `units = 0` 的行、上千金额、0.05/0.10 这类小额 |

## 自测方法

对每个 case：

```sh
python3 <你的skill>/scripts/report.py cases/case01/input.csv out.json
python3 - <<'PY'
import json
exp = json.load(open("cases/case01/expected.json", encoding="utf-8"))
got = json.load(open("out.json", encoding="utf-8"))
print(exp == got, exp, got)
PY
```

四个字段全部对上（数值差 ≤ 0.01）即该 case 通过。
