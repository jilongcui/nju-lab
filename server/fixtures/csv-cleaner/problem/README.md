# 题目包：CSV 数据清洗（v1.0.0）

> 本目录 = 实验的**题目包**，打包成 `problem.zip` 后上传到项目的「题目包」文件位。
> 题目包放的是**标准**——什么叫做对了：题面 + 判据 + IO 契约 + 用例 + 期望输出。
> 它会被下发给学生（含 `expected.csv`，用于本地自测），复验时只读挂载给驱动与 judge。

3 个用例，每个目录下 `input.csv`（脏数据）+ `expected.csv`（清洗后期望输出）。
列固定为 `name,date,amount`。

## 参考清洗规则（评分以 `expected.csv` 为准）

1. 所有字段去除首尾空白
2. 日期列统一为 `YYYY-MM-DD`（输入可能出现 `YYYY/M/D`、`DD-MM-YYYY`、`YYYY.MM.DD`）
3. 规范化后完全重复的行只保留首次出现
4. 含空字段的行直接删除
5. 表头原样保留，行顺序保持首次出现的顺序

## 为什么本包没有 `task.md` / `judge.md` / `manifest.json`

这是**内置回落型**样例：驱动在题目包里找不到题面与判据时，会**逐字回落**内置的
「CSV 数据清洗」语义（题面、规则、judge prompt 都写死在驱动里，见
`server/verify-image/run-eval.mjs` 的 `BUILTIN_TASK` / `CLEAN_RULES` / `JUDGE_PROMPT`），
复验结果里 `source=builtin`。

保留"没有题目文件"这个形态是**有意的**——它是包驱动改造后的**历史回归基线**：
最老的这套包必须仍然 3/3 通过。

要写自己的题，看另两个示例项目的 `problem/`（`server/fixtures/sales-report/`、
`server/fixtures/ml-basics/`）：那里带 `manifest.json` + `task.md` + `judge.md`（`source=manifest`）。

## 自测方法（学生侧）

对每个 case：

```sh
python3 <你的skill>/scripts/clean.py cases/case01/input.csv out.csv
diff out.csv cases/case01/expected.csv
```

3 个 case 全部 diff 为空即通过率 3/3。

> 判分口径：行尾空白、末尾换行、CRLF/LF 差异**不扣分**；但 `diff` 会把这三种差异报成不同，
> 逐字节自测时注意——本包的 `expected.csv` 统一用 LF。
