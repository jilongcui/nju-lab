# 实测档案（示范填写）

- 自测时间：2026-10-17（出题时实测）
- 达标情况：case01 accuracy 0.9474 / macro F1 0.9487；case02 accuracy 0.9333 / macro F1 0.9333
- 踩坑记录（pitfalls）：
  1. 只报 accuracy 不够 —— 若只认 setosa+versicolor，accuracy 看起来还行，macro F1 会掉到 0.6 左右
  2. 试过只用花瓣长度：versicolor 与 virginica 的重叠区错得更多，加回花瓣宽度才稳
  3. 混淆矩阵要按固定类别顺序画（`labels=CLASS_NAMES`），否则标签会错位
  4. 图上写中文会变方框 —— 轴标签一律英文，中文只放在 `takeaway` 里
