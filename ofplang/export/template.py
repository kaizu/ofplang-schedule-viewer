"""The single-file viewer template, and putting documents into it.

The contract is one element (design.md D48), written by `web/scripts/embed.mjs`
for the tests and by this module for everyone else:

    <script type="application/json" id="ofp-documents" data-contract="1">…</script>

Its content is `null` or `{ name, plan?, workflow?, environment?, ui? }`, each
document being the YAML text as written. `<` is written as `\\u003c` — a JSON
escape, so a `</script>` in a YAML comment cannot end the element and the text
arrives unchanged.
"""

from __future__ import annotations

import json
import re
from importlib import resources
from pathlib import Path
from typing import Any

CONTRACT = "1"

_ELEMENT = re.compile(
    r'(<script type="application/json" id="ofp-documents" data-contract="(\d+)">)(.*?)(</script>)',
    re.DOTALL,
)
_BUILD = re.compile(r'<meta name="ofp-viewer-build" content="([^"]*)"')


class TemplateError(Exception):
    """No usable template. Exit code 2."""


def load_template(override: Path | None = None) -> str:
    """The bundled template, or the one given (for development)."""
    if override is not None:
        try:
            return override.read_text(encoding="utf-8")
        except OSError as e:
            raise TemplateError(f"{override}: cannot be read ({e})") from None
    bundled = resources.files("ofplang.export") / "_template" / "viewer.html"
    if not bundled.is_file():
        raise TemplateError(
            "the viewer template is not bundled with this install — it is built from web/ "
            "and ships in the wheel; in a source checkout run `npm run build:single` in web/"
        )
    return bundled.read_text(encoding="utf-8")


def template_build(template: str) -> str | None:
    """The commit the template was built from, if it says."""
    m = _BUILD.search(template)
    return m.group(1) if m else None


def encode(payload: dict[str, Any] | None) -> str:
    """The element's body. `ensure_ascii=False` keeps the YAML as written."""
    if payload is None:
        return "null"
    return json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")


def embed(template: str, payload: dict[str, Any] | None) -> str:
    m = _ELEMENT.search(template)
    if m is None:
        raise TemplateError("not a viewer template: no #ofp-documents element")
    if m.group(2) != CONTRACT:
        raise TemplateError(f"the template speaks contract {m.group(2)}; this writes {CONTRACT}")
    body = encode(payload)
    # Sliced rather than `re.sub`, so nothing in a document is read as a pattern.
    return template[: m.start(3)] + body + template[m.end(3) :]
