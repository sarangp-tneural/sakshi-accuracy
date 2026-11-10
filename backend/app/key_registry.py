"""Server-side key binding registry. Single source: shared/actions.json."""
import json
import re

from .config import ROOT

_spec = json.loads((ROOT / "shared" / "actions.json").read_text())
ACTIONS: list[str] = [a["name"] for a in _spec["actions"]]
DEFAULT_BINDINGS: dict[str, str] = {a["name"]: a["default"] for a in _spec["actions"]}

FORBIDDEN = {
    "Tab", "Escape", "Enter", "NumpadEnter",
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight",
    "MetaLeft", "MetaRight", "OSLeft", "OSRight", "CapsLock", "ContextMenu", "Fn",
}
_ALLOWED_RE = re.compile(
    r"^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2])|Arrow(Left|Right|Up|Down)|Space|Backspace"
    r"|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote"
    r"|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|NumpadDecimal"
    r"|Home|End|PageUp|PageDown|Insert|Delete)$"
)


def is_allowed_key(code: str) -> bool:
    return code not in FORBIDDEN and bool(_ALLOWED_RE.match(code))


def merge_with_defaults(saved: dict | None) -> dict[str, str]:
    """Fill missing actions from defaults; drop unknown ones. If the result has duplicates
    (e.g. a new default collides with a saved key), the colliding *default-filled* action
    falls back to... nothing safe, so we reset the whole set to defaults."""
    saved = saved or {}
    merged = {a: saved.get(a) or DEFAULT_BINDINGS[a] for a in ACTIONS}
    if len(set(merged.values())) != len(merged) or not all(is_allowed_key(k) for k in merged.values()):
        return dict(DEFAULT_BINDINGS)
    return merged


def validate_bindings(b: dict) -> list[str]:
    """Return a list of error strings; empty means valid. Set must be complete and exact."""
    errors: list[str] = []
    if not isinstance(b, dict):
        return ["bindings must be an object"]
    unknown = sorted(set(b) - set(ACTIONS))
    missing = [a for a in ACTIONS if a not in b]
    if unknown:
        errors.append(f"unknown actions: {', '.join(unknown)}")
    if missing:
        errors.append(f"missing actions: {', '.join(missing)}")
    seen: dict[str, str] = {}
    for action in ACTIONS:
        code = b.get(action)
        if code is None:
            continue
        if not isinstance(code, str) or not is_allowed_key(code):
            errors.append(f"key not allowed for {action}: {code!r}")
            continue
        if code in seen:
            errors.append(f"duplicate key {code} used by {seen[code]} and {action}")
        else:
            seen[code] = action
    return errors
