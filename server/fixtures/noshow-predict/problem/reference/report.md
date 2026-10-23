# 实测档案（示范填写，原 reference/SKILL.md，2026-10-24 迁移）

- 自测时间：
- 达标情况：case01 ✅ / case02 ✅（recall 0.73 / 0.76，precision 0.47 / 0.55）
- 踩坑记录（每条写成一行）：
  - 不加 `class_weight` 时 recall 只有 0.17 —— 模型学会了"全判会来"这条捷径
  - 切分要 `stratify=y`，否则测试集里的失约比例可能偏得离谱，指标忽高忽低
