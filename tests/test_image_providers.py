import base64
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / "scripts" / "atlas"))

from image_providers import generate_cloudflare, generate_newapi  # noqa: E402


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class ImageProviderTest(unittest.TestCase):
    def test_cloudflare_request_uses_prompt_only_and_decodes_image(self):
        image = base64.b64encode(b"\xff\xd8\xfffake-jpeg").decode()
        response = _Response({"success": True, "result": {"image": image}})
        with patch("image_providers.urllib.request.urlopen", return_value=response) as open_url:
            with patch.dict("os.environ", {"CLOUDFLARE_ACCOUNT_ID": "account", "CLOUDFLARE_API_TOKEN": "token"}, clear=False):
                result = generate_cloudflare("draw abate", "@cf/black-forest-labs/flux-1-schnell")
        request = open_url.call_args.args[0]
        self.assertEqual(result, b"\xff\xd8\xfffake-jpeg")
        self.assertIn("/accounts/account/ai/run/@cf/black-forest-labs/flux-1-schnell", request.full_url)
        self.assertEqual(json.loads(request.data), {"prompt": "draw abate"})

    def test_newapi_request_uses_openai_compatible_contract(self):
        image = base64.b64encode(b"\x89PNG\r\n\x1a\nfake-png").decode()
        response = _Response({"data": [{"b64_json": image}]})
        with patch("image_providers.urllib.request.urlopen", return_value=response) as open_url:
            with patch.dict("os.environ", {"ATLAS_NEWAPI_BASE_URL": "https://gateway.example", "ATLAS_NEWAPI_API_KEY": "token"}, clear=False):
                result = generate_newapi("draw abate", "gpt-image-1", "1024x1024")
        request = open_url.call_args.args[0]
        self.assertEqual(result, b"\x89PNG\r\n\x1a\nfake-png")
        self.assertEqual(request.full_url, "https://gateway.example/v1/images/generations")
        self.assertEqual(json.loads(request.data), {"model": "gpt-image-1", "prompt": "draw abate", "size": "1024x1024"})
        self.assertEqual(request.get_header("User-agent"), "curl/8.21.0")


if __name__ == "__main__":
    unittest.main()
