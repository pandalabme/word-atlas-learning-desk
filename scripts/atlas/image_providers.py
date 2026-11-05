"""Image provider adapters used by the reviewable media pipeline."""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


def image_format(blob: bytes) -> str:
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if blob.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if blob.startswith(b"RIFF") and blob[8:12] == b"WEBP":
        return "webp"
    raise ValueError("image provider returned an unsupported image format")


def _request_json(request: urllib.request.Request):
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace").strip()
            raise ValueError(f"image provider HTTP {exc.code}: {detail or exc.reason}") from exc
        except Exception as exc:
            last_error = exc
            if attempt == 2:
                raise
            time.sleep(2**attempt)
    raise last_error  # pragma: no cover


def generate_openai(prompt: str, model: str, size: str, endpoint: str) -> bytes:
    key = os.getenv("ATLAS_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not key:
        raise ValueError("Set ATLAS_OPENAI_API_KEY (or OPENAI_API_KEY) for image generation")
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "output_format": "png",
    }).encode()
    request = urllib.request.Request(
        endpoint.rstrip("/") + "/images/generations",
        payload,
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    response = _request_json(request)
    try:
        return base64.b64decode(response["data"][0]["b64_json"])
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("OpenAI image response did not contain b64_json image data") from exc


def generate_cloudflare(prompt: str, model: str) -> bytes:
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
    token = os.getenv("CLOUDFLARE_API_TOKEN")
    if not account_id or not token:
        raise ValueError("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for Cloudflare image generation")
    endpoint = os.getenv("ATLAS_CLOUDFLARE_BASE_URL", "https://api.cloudflare.com/client/v4").rstrip("/")
    model_path = urllib.parse.quote(model, safe="@/")
    payload = json.dumps({"prompt": prompt}).encode()
    request = urllib.request.Request(
        f"{endpoint}/accounts/{urllib.parse.quote(account_id, safe='')}/ai/run/{model_path}",
        payload,
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    response = _request_json(request)
    if response.get("success") is not True:
        raise ValueError(f"Cloudflare image request failed: {json.dumps(response, ensure_ascii=False)}")
    try:
        return base64.b64decode(response["result"]["image"])
    except (KeyError, TypeError) as exc:
        raise ValueError("Cloudflare image response did not contain result.image") from exc


def _generations_endpoint(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/images/generations"):
        return base
    if base.endswith("/v1"):
        return base + "/images/generations"
    return base + "/v1/images/generations"


def generate_newapi(prompt: str, model: str, size: str) -> bytes:
    """Call a New API OpenAI-compatible image-generation gateway."""
    key = os.getenv("ATLAS_NEWAPI_API_KEY") or os.getenv("NEWAPI_API_KEY")
    base_url = os.getenv("ATLAS_NEWAPI_BASE_URL") or os.getenv("NEWAPI_BASE_URL")
    if not key:
        raise ValueError("Set ATLAS_NEWAPI_API_KEY (or NEWAPI_API_KEY) for New API image generation")
    if not base_url:
        raise ValueError("Set ATLAS_NEWAPI_BASE_URL (or NEWAPI_BASE_URL) for New API image generation")
    # Some OpenAI-compatible gateways reject urllib's default Python-urllib UA at the edge.
    user_agent = os.getenv("ATLAS_NEWAPI_USER_AGENT", "curl/8.21.0")
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "size": size,
    }).encode()
    request = urllib.request.Request(
        _generations_endpoint(base_url),
        payload,
        {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "*/*",
            "User-Agent": user_agent,
        },
    )
    response = _request_json(request)
    try:
        item = response["data"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("New API image response did not contain data[0]") from exc
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    if item.get("url"):
        image_request = urllib.request.Request(
            item["url"],
            headers={"Authorization": f"Bearer {key}", "Accept": "*/*", "User-Agent": user_agent},
        )
        with urllib.request.urlopen(image_request, timeout=180) as image_response:
            return image_response.read()
    raise ValueError("New API image response contained neither b64_json nor url")


def generate_image(provider: str, prompt: str, model: str, size: str, openai_endpoint: str) -> bytes:
    if provider == "openai":
        return generate_openai(prompt, model, size, openai_endpoint)
    if provider == "cloudflare":
        return generate_cloudflare(prompt, model)
    if provider == "newapi":
        return generate_newapi(prompt, model, size)
    raise ValueError(f"unsupported image provider: {provider}")
