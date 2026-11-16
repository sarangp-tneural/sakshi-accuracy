from app import key_registry as kr


def test_defaults_valid_and_complete():
    assert kr.validate_bindings(dict(kr.DEFAULT_BINDINGS)) == []
    assert len(kr.ACTIONS) == 9


def test_duplicate():
    b = dict(kr.DEFAULT_BINDINGS, jump_back="KeyZ")
    assert any("duplicate" in e for e in kr.validate_bindings(b))


def test_unknown_and_missing():
    b = dict(kr.DEFAULT_BINDINGS)
    del b["undo"]
    b["fly"] = "KeyQ"
    errs = " ".join(kr.validate_bindings(b))
    assert "missing actions: undo" in errs and "unknown actions: fly" in errs


def test_disallowed_keys():
    for bad in ["Tab", "Escape", "Enter", "ShiftLeft", "ControlLeft", "AltRight", "MetaLeft", "Nope", ""]:
        assert kr.validate_bindings(dict(kr.DEFAULT_BINDINGS, jump_back=bad)), bad


def test_merge_fills_missing():
    saved = {"jump_back": "KeyQ"}
    m = kr.merge_with_defaults(saved)
    assert m["jump_back"] == "KeyQ" and m["undo"] == "KeyZ" and set(m) == set(kr.ACTIONS)


def test_merge_collision_falls_back_to_defaults():
    # a saved key equals the default of a missing action -> would duplicate
    m = kr.merge_with_defaults({"jump_back": "KeyZ"})
    assert m == kr.DEFAULT_BINDINGS


def test_merge_empty_and_unknown_dropped():
    assert kr.merge_with_defaults(None) == kr.DEFAULT_BINDINGS
    assert "zzz" not in kr.merge_with_defaults({"zzz": "KeyQ"})
