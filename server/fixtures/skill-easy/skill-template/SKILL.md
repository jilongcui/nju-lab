# 检验报告判定脚本（学生起点）

> 这个目录是**你的方案**：`SKILL.md` 写"这个技能什么时候该用、不该用"，
> `report.md` 记录自测与踩坑。**代码里的 TODO 才是你要改的地方**（文档不用改）。

## 实验材料（都在题目包 `problem/` 里）

- `problem/task.md` —— 七条判定顺序、两条边界、交付格式、验收标准
- `problem/cases/` —— case01（10 行）/ case02（12 行），各带 `report.csv` + `reference_ranges.csv` + `expected.json`
- `problem/judge.md` —— 语义判据
- `problem/reference/` —— 一份走完六步的示范

## 能力边界

> 这一节是技能说明书的一部分；**平台不检查这一节**，按实际情况补两句即可。

- 能处理：与 `report.csv` 同结构的检验结果（`item,value`），项目在区间表里能查到
- 不处理：影像/病理报告、需要结合病史的判断、参考区间随年龄性别变化的项目（本表是固定区间）
- 写死的假设：区间表里没有的项目一律 `unknown`；危急值闭区间、参考区间严格不等；同一项目多行按行序各自判定

## 六步流程

① 看清需求（七条顺序 + 两条边界）→ ② 看数据（空值 / 表外项目 / 空格子）→ ③ 实现判定 →
④ 抽危急值（带阈值）→ ⑤ 计数 → ⑥ 写结论

材料配合：读 `problem/task.md` → 改 `scripts/solve.py` 里的 TODO → 两个 case 都跑 →
补能力边界（平台不检查）→ 提交；**报告写进 `report.md`**（平台按它评过程分）。

## 自测

```sh
python3 scripts/solve.py ../problem/cases/case01 ../case01/output.json --fig-dir figures/case01
python3 scripts/solve.py ../problem/cases/case02 ../case02/output.json --fig-dir figures/case02
```
