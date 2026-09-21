# 标准测试数据集：CSV 数据清洗（v1.0.0）

3 个用例，每个目录下 `input.csv`（脏数据）+ `expected.csv`（清洗后期望输出）。

## 参考清洗规则（评分以 expected.csv 为准）

1. 所有字段去除首尾空白
2. 日期列统一为 `YYYY-MM-DD`（输入可能出现 `YYYY/M/D`、`DD-MM-YYYY`、`YYYY.MM.DD`）
3. 规范化后完全重复的行只保留首次出现
4. 含空字段的行直接删除
5. 表头原样保留，行顺序保持首次出现的顺序

## 自测方法

对每个 case：

```sh
python3 <你的skill>/scripts/clean.py cases/case01/input.csv out.csv
diff out.csv cases/case01/expected.csv
```

3 个 case 全部 diff 为空即通过率 3/3。
