# 参考实现（示范）

> 出题时的示范：一份走完六步的 `scripts/solve.py`。平台不检查这份内容，只要求它在题包里。

## 怎么做

1. 读 `patients.csv`（建 dict）、`requests.txt`（逐行）、`memory_seed.json`（初始记忆）；
2. **感知**：在请求里找第一个 `P` + 三位数字的子串；含"复查"→ `复查`，否则 `一般咨询`；
3. **决策**：按六条规则的先后顺序落（invalid_request → unknown_patient → urgent → recall → annual → none），
   同时算出 `days_since_visit`；
4. **行动**：按消息模板逐字拼；`last_contact` 取**处理本条之前**的记忆，没有就写 `未联系`；
5. **记忆**：只有正常决策写 `{last_contact, last_action}`，无效/未知患者不写；
6. 画各类动作条数柱状图（轴标签英文），写 `output.json`，`notes` 说清哪条规则最容易错。

## 实测记录

见同目录 `report.md`（示范填写）。
