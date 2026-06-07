import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend', 'shared'))

from hashing import generate_alias, is_valid_url_syntax


def test_valid_url_returns_alias():
    alias, message = generate_alias("https://example.com/page", 1700000000)
    assert message == "Success"
    assert len(alias) == 6
    assert alias.isalnum()


def test_same_url_same_epoch_deterministic():
    alias1, _ = generate_alias("https://example.com/page", 1700000000)
    alias2, _ = generate_alias("https://example.com/page", 1700000000)
    assert alias1 == alias2


def test_same_url_diff_epoch_different_alias():
    alias1, _ = generate_alias("https://example.com/page", 1700000000)
    alias2, _ = generate_alias("https://example.com/page", 1700000001)
    assert alias1 != alias2


def test_trailing_slash_same_as_no_slash():
    alias1, _ = generate_alias("https://a.com/", 1700000000)
    alias2, _ = generate_alias("https://a.com", 1700000000)
    assert alias1 == alias2


def test_empty_url_returns_error():
    alias, message = generate_alias("", 1700000000)
    assert alias == ""
    assert message == "Invalid Input Data"


def test_invalid_url_no_scheme_returns_error():
    alias, message = generate_alias("confluence/page", 1700000000)
    assert alias == ""
    assert message == "Invalid Input Data"


def test_epoch_zero_returns_error():
    alias, message = generate_alias("https://example.com", 0)
    assert alias == ""
    assert message == "Invalid Input Data"
