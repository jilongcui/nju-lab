# 应用实验 C：会员价值分级（多分类）

**形态：应用驱动** —— 学生拿到**需求**（把会员分成低/中/高三档、好分配运营资源）与达标要求
（**macro F1 ≥ 0.60** 且 **每一档召回 ≥ 0.50**、可复现、说清选择）；**模型/特征/预处理自己定**。

```
customer-tier/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约 + 9 条确定性断言（达标线 / 逐档召回防退化 / 基线核对）
│   ├── task.md         需求 + 四条要求 + 数据字典 + 交付格式
│   ├── judge.md        语义判据（说清选择、自洽性、可疑地过于好、基线定义）
│   ├── README.md       导学
│   ├── cases/case0N/{data.csv, expected.json}
│   └── reference/      参考实现（标准化 + 多分类逻辑回归）—— 随包下发
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，两个 TODO 自己填）
├── tools/gen_data.py                        造题工具：固定种子生成数据（**不下发**）
└── README.md
```

## 场景与数据

- 应用：把会员按价值分成 **低 / 中 / 高** 三档（低档促活、中档复购提醒、高档专属客服）
- 数据（合成教学数据，列名皆日常概念）：`monthly_spend` / `visits_per_month` /
  `months_since_signup` / `avg_order_value` / `support_tickets` → `tier`（0/1/2）
- 三档比例约 **40% / 35% / 25%**（不平均，正是"要看 macro"的原因）
- case01（900 行）、case02（600 行，另一家门店/季度）

## 判据设计要点（多分类的**防退化**）

1. **达标线用 macro F1（≥ 0.60）**：macro 先对每一档各自算 F1 再平均 ——
   不被"人最多的低档"主导。对比：基线（全判低档）accuracy 有 0.40，macro F1 只有 0.19。
2. **再加"每一档召回 ≥ 0.50"**：这是**防退化**的关键 —— 只保大类（把中/高档都丢给低档）
   能凑出还行的 accuracy，但会让某一档的召回掉到接近 0，立刻被这条卡住。
3. **基线必须"不做预测"**：现有做法 = 一律判多数类 → 断言核对
   `|baseline.accuracy − 0.40| ≤ 15%` **且** `baseline.macro_f1 < 0.4`（防"填个训练过的模型当基线"）。
4. **达标线由"认真做能达到"定**：参考实现（`StandardScaler` + 多分类 LR）macro F1
   0.77 / 0.68、最低档召回 0.71 / 0.57 → 达标线两端都留了余量。
5. **语义判定（`judge.md`）**：`notes` 有没有讲清"为什么用 macro 而不是 accuracy"、
   model 与指标是否自洽、`per_class_recall` 与 `macro_f1` 是否矛盾、是否可疑地过于好。

## 打包 / 自检 / 上传

```sh
cd server/fixtures/customer-tier
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构 + 依赖自检
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg5 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧自检闭环（拿参考实现跑复验，应全部通过）
docker run --rm --env-file ../../../server/.env -v "$PWD:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg5 \
  --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

## 重新生成数据与参考水平

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg5 /w/tools/gen_data.py
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg5 /w/problem/reference/scripts/train.py --regen-expected
```

## 出题提醒

- **别把达标线抬到"只有一种模型能过"**：应用任务允许多种解法；达标线应让"两个退化解都过不了、
  认真做能过"（这里的退化解是"全判多数类"与"放弃某一档"）。
- **改动档位比例或噪声后要重新标定**：比例越不平均，macro 与 accuracy 的差距越大、
  教学点越明显，但小档位的召回也越难做（参考实现的余量会变小）。
- 想加难度：把三档改成四档、或让某一档样本极少（此时"逐档召回下限"要相应放宽）。

## 实测记录

### 2026-10-30（初版）

| case | 规模 | 三档比例 | 基线（全判低档） | 参考实现（标准化 + 多分类 LR） |
|---|---|---|---|---|
| case01 | 900 | 40/35/25% | accuracy 0.40、macro F1 **0.19** | macro F1 **0.772**、逐档召回 [0.84, 0.71, 0.75] |
| case02 | 600 | 40/35/25% | accuracy 0.40、macro F1 **0.19** | macro F1 **0.680**、逐档召回 [0.83, 0.62, 0.57] |

→ 达标线（macro F1 ≥ 0.60 / 每档召回 ≥ 0.50）：基线与"放弃某一档"的退化解都过不了，
参考实现有 8~13% 余量。另测到：**不标准化时多分类逻辑回归收敛不了**（量纲差异太大）——
这正好是"预处理会影响成败"的教学点，已写进 `reference/SKILL.md`。

**`--check`**：通过（cases `[case01, case02]`、inputs `[data.csv]`、识别到 **9 条断言**、依赖 ok）。

**复验（pkg5）**：参考实现 **2/2 通过**（`hard=9/9`，case01 71.4s / case02 69.9s）。

**平台**：项目「实验：会员价值分级（多分类）」已创建并发布
（`problem.zip` sha256 `5b12ba8d…` 与本地一致），5 个教学字段按 §3.5 写入。
