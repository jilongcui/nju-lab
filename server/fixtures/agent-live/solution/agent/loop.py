"""循环（参考实现）：模型决定下一步，代码执行并回填观察。"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from .data import Packet
from .llm import LlmClient
from .memory import Memory
from .tools import run_tool

KB_RE = re.compile(r"KB-\d{2}")
SITE_PATTERNS = (
    re.compile(r"我(?:负责|管|看)\s*([A-Za-z])\s*区"),
    re.compile(r"负责\s*([A-Za-z])\s*区"),
)
CORRECT_PATTERN = re.compile(r"更正[：:]\s*(?:我)?(?:其实)?(?:负责|管)?\s*([A-Za-z])\s*区")


@dataclass
class Ctx:
    client: LlmClient
    packet: Packet
    memory: Memory
    profile: dict


def build_system_prompt(profile: dict, packet: Packet) -> str:
    tools = json.dumps(packet.tool_specs, ensure_ascii=False, indent=2)
    refuse = packet.limits.get("messages", {}).get("refuse_lifetime", "")
    return "\n".join([
        f"你是「{profile.get('display_name', '维护助手')}」。语气：{profile.get('tone', '简洁')}。",
        "每一步只输出一个 JSON 对象，不要输出别的文字。两种动作：",
        '  调工具：{"action":"tool","tool":"<工具名>","args":{...}}',
        '  给答复：{"action":"finish","text":"<给用户的答复>"}',
        "可用工具（含参数说明）：",
        tools,
        "规则：",
        "1. 涉及台账、逾期、手册要求的问题，先用工具查，再据实回答；不要凭记忆编数据。",
        "2. 引用手册时写出段落编号（如 KB-03），且只能引用工具返回过的编号。",
        "3. 剩余寿命、能否继续使用，远程不得给出结论：直接拒答并说明必须持证人员现场判定，"
        "然后把话题引回你能查的东西（保养记录、手册要求）。",
        f"4. 拒答时可以参考这句话术：{refuse}",
        "5. 用户说过的长期事实（比如负责哪个区）会在【已知事实】里给出，直接用，不要重复追问。",
    ])


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


def collect_citations(answer_text: str, observations: list[str]) -> list[str]:
    seen: set[str] = set()
    for obs in observations:
        seen.update(KB_RE.findall(obs or ""))
    return sorted({c for c in KB_RE.findall(answer_text or "") if c in seen})


def update_memory(user_text: str, memory: Memory, turn: int) -> list[str]:
    corrected = CORRECT_PATTERN.search(user_text)
    if corrected:
        memory.correct("site", f"{corrected.group(1).upper()} 区", turn)
        return []  # 更正轮不应用旧值
    for pattern in SITE_PATTERNS:
        hit = pattern.search(user_text)
        if hit:
            memory.write("site", f"{hit.group(1).upper()} 区", turn)
            return ["site"]
    return ["site"] if memory.has("site") else []


def _refused(user_text: str, answer: str, limit_msg: str) -> bool:
    """只在"用户要寿命结论、且回答明确拒绝"时算拒答。

    不能用"回答里出现不能"这种松判定：正常回答在解释边界时也会提到"不能远程给"，
    那样会把普通轮次误记成拒答（指标与引用规则都会跟着错）。
    """
    asked = any(k in user_text for k in ("寿命", "还能用", "还能撑", "继续用", "再用多久"))
    declined = any(k in answer for k in ("不能", "无法", "不得", "不宜", "拒绝"))
    echo = bool(limit_msg) and limit_msg[:12] in answer
    return bool(asked and (declined or echo))


def run_dialogue(dialogue: list[dict], ctx: Ctx) -> dict:
    packet = ctx.packet
    max_steps = int(packet.limits.get("max_steps_per_turn") or 4)
    window = int(packet.limits.get("window") or 6)
    system = build_system_prompt(ctx.profile, packet)

    terminated: list[str] = []
    turns: list[dict] = []
    applied: list[dict] = []
    history: list[tuple[str, str]] = []

    for item in dialogue:
        turn = int(item["turn"])
        user = str(item["user"])
        ctx.client.current["turn"] = turn

        keys = update_memory(user, ctx.memory, turn)
        if keys:
            applied.append({"turn": turn, "keys": keys})

        facts = ctx.memory.active()
        fact_line = "【已知事实】" + ("；".join(f"{k}={v}" for k, v in facts.items()) if facts else "无")
        messages: list[dict] = [{"role": "system", "content": system + "\n" + fact_line}]
        for prev_user, prev_answer in history[-window:]:
            messages.append({"role": "user", "content": prev_user})
            messages.append({"role": "assistant", "content": prev_answer})
        messages.append({"role": "user", "content": user})

        steps: list[dict] = []
        observations: list[str] = []
        answer = ""
        done = False

        for step in range(1, max_steps + 1):
            raw = ctx.client.chat(messages, temperature=0.2, max_tokens=700)
            action = parse_action(raw)
            if action.get("action") == "tool":
                name = str(action.get("tool") or "")
                args = action.get("args") if isinstance(action.get("args"), dict) else {}
                obs, is_error = run_tool(name, args, packet)
                observations.append(obs)
                steps.append({
                    "step": step, "action": "tool", "tool": name,
                    "args": args, "observation": obs, "error": is_error,
                })
                messages.append({"role": "assistant", "content": json.dumps(action, ensure_ascii=False)})
                messages.append({"role": "user", "content": f"工具 {name} 的返回：\n{obs}"})
                continue
            answer = str(action.get("text") or raw or "").strip()
            steps.append({"step": step, "action": "finish", "observation": "完成"})
            done = True
            break

        if not done:
            tail = "\n".join(observations[-2:]) if observations else "这一轮没查到内容。"
            answer = f"（本轮步数用尽）我先把已查到的给你：\n{tail}"
        if len(answer) < 5:
            answer = (answer + " 请补充设备编号或站点后再问。").strip()

        if done:
            terminated.append("done")
        else:
            terminated.append("max_steps")

        turns.append({
            "turn": turn,
            "user": user,
            "steps": steps,
            "answer": answer,
            "citations": collect_citations(answer, observations),
            "refused": _refused(user, answer, packet.limits.get("messages", {}).get("refuse_lifetime", "")),
        })
        history.append((user, answer))

    return {"terminated": terminated, "turns": turns, "memory": ctx.memory.snapshot(applied)}
