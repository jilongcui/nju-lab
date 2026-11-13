"""循环：问模型 → 解析动作 → 执行 → 观察 → 再问。**这个文件是核心，要你写。**

一组对话 = 若干轮；一轮 = 若干步；一步 = 一次模型决策 + 一次执行。

一条健康的轨迹长这样：

    用户：这个月哪些设备该保养了
    第 1 步  模型决定调 overdue_assets  → 观察：A-02 逾期 76 天 …
    第 2 步  模型决定调 search_manual   → 观察：KB-01 … KB-02 …
    第 3 步  模型说 finish + 答案       → 本轮结束（done）

如果你写成"每轮只问一次模型，然后代码按固定顺序调工具"，那不是循环，是流水线 ——
`judge.md` 的 B 维会按这个区分给分。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from .data import Packet
from .llm import LlmClient
from .memory import Memory
from .tools import run_tool

KB_RE = re.compile(r"KB-\d{2}")


@dataclass
class Ctx:
    """一组对话的上下文。**不用改。**"""
    client: LlmClient
    packet: Packet
    memory: Memory
    profile: dict


# ---------------------------------------------------------------- 系统提示（TODO）
def build_system_prompt(profile: dict, packet: Packet) -> str:
    """拼系统提示。**要你写。**

    里面至少要讲清四件事：

    1. **你是谁**：`profile` 里的名字 / 语气 / 禁语；
    2. **你能用哪些工具**：`packet.tool_specs` 里每个工具的 name + description + 参数；
    3. **动作格式**：模型每一步只能输出**一个 JSON 对象**，例如
       `{"action": "tool", "tool": "query_assets", "args": {"site": "A 区"}}`
       `{"action": "finish", "text": "给用户的答复"}`；
    4. **边界**：`KB-05` 规定剩余寿命不得远程下结论 —— 遇到就直接拒答，
       并把话题引回"能查的"（保养记录 + 手册要求）。

    提示：把工具名册用 JSON 形式贴进提示，比用自然语言描述准得多。
    """
    raise NotImplementedError("TODO: 实现 build_system_prompt")


# ---------------------------------------------------------------- 解析（已给好）
def parse_action(text: str) -> dict:
    """从模型输出里取出 JSON 动作。**不用改。**

    容忍三种常见脏输出：```json 代码块、前后多余文字、干脆没给 JSON。
    模型有时会一口气输出两个动作 —— 这里只取**第一个**能解析的对象，剩下的丢掉
    （下一步会重新问它）。最后一种情况当成"直接回答"，这样即使模型不听话，
    这一轮也不会白跑。
    """
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()
    decoder = json.JSONDecoder()
    for start, ch in enumerate(raw):
        if ch != "{":
            continue
        try:
            action, _ = decoder.raw_decode(raw[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(action, dict) and action.get("action"):
            return action
    return {"action": "answer", "text": raw}


# ---------------------------------------------------------------- 引用（已给好）
def collect_citations(answer_text: str, observations: list[str]) -> list[str]:
    """从答复里挑出**本轮真的检索到过**的段落编号。**不用改。**"""
    seen = set()
    for obs in observations:
        seen.update(KB_RE.findall(obs or ""))
    return sorted({c for c in KB_RE.findall(answer_text or "") if c in seen})


# ---------------------------------------------------------------- 记忆写入（TODO）
def update_memory(user_text: str, memory: Memory, turn: int) -> list[str]:
    """从用户这句话里抽出要记住的事实。**要你写。**

    至少处理三种说法：

    - `我负责 A 区` → `write("site", "A 区", turn)`；
    - `更正：我其实负责 B 区，不是 A 区` → `correct("site", "B 区", turn)`；
    - 其它话 → 什么都不做。

    返回本轮**应用**到的 key 列表（例如 `["site"]`），run.py 会把它记进
    `memory.applied` —— 这是"记忆真的生效了"的证据。

    注意：`更正：…` 这一轮只做更正，不要把旧值再应用一遍。
    """
    raise NotImplementedError("TODO: 实现 update_memory")


# ---------------------------------------------------------------- 循环（TODO）
def run_dialogue(dialogue: list[dict], ctx: Ctx) -> dict:
    """跑完一组对话。**核心，要你写。**

    返回：

    ```
    {"terminated": ["done", "done", ...],          # 每轮一条
     "turns": [{"turn", "user", "steps", "answer", "citations", "refused"}, ...],
     "memory": memory.snapshot(applied)}
    ```

    每轮要做的事：

    1. `ctx.client.current["turn"] = turn`（让调用账本能归到这一轮）；
    2. 调 `update_memory(...)`，把应用到的 key 记进 `applied`；
    3. 组 messages：系统提示 + 记忆里当前成立的事实 + 这一轮的用户话；
    4. **循环最多 `packet.limits["max_steps_per_turn"]` 步**：
       `chat()` → `parse_action()` →
       - `tool`：`run_tool()` 拿到观察，记 `steps`，把观察**回填进 messages**，继续下一步；
       - `answer` / `finish`：拿到答复，本轮 `terminated="done"`，跳出；
    5. 步数用尽还没结束：`terminated="max_steps"`，并且**照样给一句答复**
       （把最后的观察整理成话，不要留空）；
    6. `citations = collect_citations(answer, 本轮所有 observation)`；
    7. `refused`：这一轮是不是拒答（模型说拒答、或答复命中 `packet.limits["messages"]` 的拒答话术）。

    每个 `steps` 元素至少含：`{"step", "action", "tool"?, "args"?, "observation"}`，
    `observation` 不能是空串（模型看不到观察，就只能在原地瞎猜）。
    """
    raise NotImplementedError("TODO: 实现 run_dialogue")
