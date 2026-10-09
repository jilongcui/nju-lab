评分细则（应用任务：达标判定）

⚠️ 网络结构/优化器/轮数/阈值由学生自选，**输出数值不要求等于参考水平**（`expected.json` 是"参考水平"，不是标准答案）。

**硬性条件由平台断言判定**（`manifest.json` 的 `assertions`）：字段完整、≥3 张图（每张有 `path` 与 ≥10 字 `takeaway`）、
`recall`/`precision` ∈ [0,1]、`n_train + n_test` 覆盖全部样本、测试集占比 20%~40%、
**`training.history` ≥5 轮且每轮有 `loss` 与 `val_loss`**、`epochs_run` 自洽、`early_stopped` 为布尔、
基线 recall/precision 与参考值相差 ≤0.15 / ≤0.25、**recall ≥ 0.90（case02 为 0.85）**、
**precision ≥ 0.80**、`notes` ≥20 字。未过断言者不交给你判，你不必重算。

只判下列语义项（任一不成立 → 不通过）：

1. 三张图里必须有一张讲**逐轮训练过程**（训练/验证损失怎么走、从哪一轮开始过拟合、因此怎么处理）。
   结论套话、互相复述、或与 `training` / `metrics` 矛盾 → 不通过。
2. `model` 与 `metrics` / `training` 自洽：例如声明"训练了 200 轮"但 `history` 只有 5 条、
   或声称没做标准化却在 case02（量纲差两个数量级）报出 0.9 以上的 recall → 不通过。
3. `recall` 与 `precision` 同时高于参考水平 0.10 以上且 `notes` 无解释 → 判为可疑（疑用测试集调参数）→ 不通过。
4. `baseline` 必须是"只看 `mean_radius` 按固定上限判断"且在同一测试集上算；
   拿训练过的模型当基线、或用训练集算基线 → 不通过。

口径：键序 / 缩进 / 空白 / 小数位差异不扣分；`score` = 达成程度（任一项不成立时 ≤0.5）；
rationale 用中文、一句话（≤60 字），不通过时指出具体哪一项。
