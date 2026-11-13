"""模型客户端：重试 + token 记账 + 调用日志。**这个文件不用改。**

为什么单独一层：循环里每次决策都要问模型，如果调用散落在各处，
"这一轮到底问了几次、花了多少 token、慢在哪"就查不出来了 ——
而这三件事恰恰是 agent 好不好调的关键证据。
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"


class LlmError(RuntimeError):
    """模型调用失败（没配 key / 网络不通 / 返回不是 JSON）。"""


class LlmClient:
    """薄封装：一个 `chat()` 方法 + 一份 `calls` 账本。"""

    def __init__(self, base_url: str | None = None, model: str | None = None,
                 timeout: int = 120, retries: int = 2):
        self.base_url = (base_url or os.environ.get("AGENT_LLM_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.model = model or os.environ.get("AGENT_LLM_MODEL") or DEFAULT_MODEL
        self.api_key = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("AGENT_LLM_API_KEY") or ""
        if not self.api_key:
            raise LlmError(
                "未找到 DEEPSEEK_API_KEY：平台工作台默认已配；本地自测请 `export DEEPSEEK_API_KEY=...`"
            )
        self.timeout = timeout
        self.retries = retries
        self.calls: list[dict] = []
        # run.py 每轮会更新这两个字段，让账本能归到具体对话/轮次
        self.current = {"dialogue": None, "turn": None}

    # ---------------------------------------------------------------- 对外
    def chat(self, messages: list[dict], temperature: float = 0.3,
             max_tokens: int = 800, response_format: str | None = None) -> str:
        """发一轮对话，返回模型文本。失败会重试，最终失败抛 LlmError。"""
        body: dict = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format:
            body["response_format"] = {"type": response_format}

        last: Exception | None = None
        for attempt in range(self.retries + 1):
            started = time.time()
            try:
                data = self._post(body)
            except Exception as exc:  # noqa: BLE001 - 统一重试，最后抛出
                last = exc
                if attempt < self.retries:
                    time.sleep(1.5 * (attempt + 1))
                continue
            self.calls.append({
                "dialogue": self.current.get("dialogue"),
                "turn": self.current.get("turn"),
                "model": data.get("model") or self.model,
                "prompt_tokens": int((data.get("usage") or {}).get("prompt_tokens") or 0),
                "completion_tokens": int((data.get("usage") or {}).get("completion_tokens") or 0),
                "latency_ms": int((time.time() - started) * 1000),
            })
            choice = (data.get("choices") or [{}])[0]
            return ((choice.get("message") or {}).get("content") or "").strip()
        raise LlmError(f"模型调用失败：{last}")

    # ---------------------------------------------------------------- 内部
    def _post(self, body: dict) -> dict:
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise LlmError(f"HTTP {exc.code}: {detail}") from exc
        if not isinstance(data, dict) or "choices" not in data:
            raise LlmError(f"返回结构不认识：{str(data)[:200]}")
        return data
