#!/usr/bin/env python3
"""把当前目录的应用产物打包上传到平台（**在实验工作台容器里跑**）。

为什么要这个脚本：学生的工作区在**远端容器**里（dsh 工作台），浏览器拿不到容器里的文件 ——
所以"在网页上点上传"这条路对平台学员是走不通的。工作台容器里已经注入了

    NJU_LAB_SERVER_URL   # 平台 API 基址，例如 http://medai.nju.edu.cn/lab/api
    NJU_LAB_TOKEN        # 你自己的 API Token（过期可在平台右上角重新领）

于是"打包 + 上传 + 发布"可以一条命令做完：

    python3 publish_app.py --app <应用 id>              # 只上传一版
    python3 publish_app.py --app <应用 id> --publish    # 上传并发布，打印分享链接

`<应用 id>` 在平台「我的应用」页新建应用后就能看到（也可以从页面 URL 里抄）。

只打包这五样东西（别的文件不会带上去）：
    app.json  app_host.py  harness/  web/  kb/
这样做是因为工作区里还有题目材料、输出、日志 —— 全打进去会让产物又大又不可复现。
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

INCLUDE = ("app.json", "app_host.py", "harness", "web", "kb")
# 产物必须齐这几样（缺了容器里根本起不来 —— 2026-11-11 实测：漏 app_host.py 时
# 容器日志是 `python3: can't open file '/work/app/app_host.py'`，网页侧只看到 503）
REQUIRED = ("app.json", "app_host.py", "harness/api.py", "web/index.html")
SKIP_DIRS = {"__pycache__", ".git", "figures", "outputs", "node_modules"}


def build_zip(root: Path) -> bytes:
    """把 `INCLUDE` 里的东西打成一个 zip（相对 root 的路径，跳过缓存与输出）。"""
    missing = [name for name in REQUIRED if not (root / name).exists()]
    if missing:
        raise SystemExit(
            "产物缺文件：" + ", ".join(missing)
            + "\n（在 Skill 根下运行；app_host.py 是平台提供的宿主，别删也别改）"
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in INCLUDE:
            target = root / name
            if target.is_file():
                zf.write(target, name)
                continue
            if not target.is_dir():
                continue
            for path in sorted(target.rglob("*")):
                if not path.is_file():
                    continue
                if any(part in SKIP_DIRS for part in path.parts):
                    continue
                zf.write(path, path.relative_to(root).as_posix())
    return buf.getvalue()


def post_multipart(url: str, token: str, filename: str, payload: bytes) -> dict:
    boundary = uuid.uuid4().hex
    body = b"".join([
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/zip\r\n\r\n".encode(),
        payload,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    return _send(req)


def post_json(url: str, token: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload or {}).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    return _send(req)


def _send(req: urllib.request.Request) -> dict:
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        hint = {
            401: "token 失效：到平台右上角「API Token」重新领一个，再 export NJU_LAB_TOKEN=…",
            403: "这个应用不是你的（或 token 不是本人）：检查 --app 的 id",
            404: "应用不存在：先在平台「我的应用」新建一个，再抄它的 id",
            413: "产物太大：检查是不是把题目材料/日志打进去了（脚本只打 app.json/harness/web/kb）",
        }.get(exc.code, "")
        raise SystemExit(f"上传失败 {exc.code}：{detail}\n{hint}")
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"连不上平台（{req.full_url}）：{exc}\n"
            "确认在工作台容器里跑，且 NJU_LAB_SERVER_URL 已注入（平台会自动注入）"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="打包并上传应用产物到平台")
    ap.add_argument("--app", required=True, help="应用 id（平台「我的应用」里新建后可见）")
    ap.add_argument("--dir", default=".", help="应用根目录（默认当前目录）")
    ap.add_argument("--publish", action="store_true", help="上传后立即发布并打印分享链接")
    args = ap.parse_args()

    server = os.environ.get("NJU_LAB_SERVER_URL", "").rstrip("/")
    token = os.environ.get("NJU_LAB_TOKEN", "")
    if not server or not token:
        raise SystemExit(
            "缺少 NJU_LAB_SERVER_URL / NJU_LAB_TOKEN：请在**平台工作台容器**里运行本脚本"
            "（本地跑也可以手动 export 这两个变量）"
        )

    root = Path(args.dir).resolve()
    payload = build_zip(root)
    digest = hashlib.sha256(payload).hexdigest()
    print(f"[1/2] 打包完成：{len(payload) / 1024:.1f} KB，sha256 {digest[:12]}")

    res = post_multipart(f"{server}/apps/{args.app}/versions", token, "app.zip", payload)["data"]
    print(f"      版本已上传：{res['id'][:8]}（{res['size'] / 1024:.1f} KB）")

    if args.publish:
        app = post_json(f"{server}/apps/{args.app}/publish", token)["data"]
        key = app.get("shareKey")
        print(f"[2/2] 已发布。分享链接（无需登录）：")
        print(f"      {server.replace('/lab/api', '/lab/api')}/apps/share/{key}/site")
        print(f"      或直接在平台「我的应用」里点「分享链接」复制")


if __name__ == "__main__":
    main()
