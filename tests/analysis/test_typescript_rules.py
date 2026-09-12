from pathlib import Path

import pytest

from scb_check.analysis.astgrep import run_sg
from scb_check.pipeline import analyze_files
from scb_check.resources import rules_file

_CASES = {
    "ts-catch-static-fallback": (
        "function parse(s: string) { try { return JSON.parse(s); } catch { return {}; } }",
        "function parse(s: string) { try { return JSON.parse(s); } catch (error) { console.error(error); return {}; } }",
    ),
    "ts-empty-catch": (
        "try { work(); } catch {}",
        "try { work(); } catch (error) { report(error); }",
    ),
    "ts-rethrow-only-catch": (
        "try { work(); } catch (error) { throw error; }",
        'try { work(); } catch (error) { throw new Error("Context", { cause: error }); }',
    ),
    "ts-boolean-ternary": (
        "const value = input ? true : false;",
        'const value = input ? "yes" : "no";',
    ),
    "ts-boolean-return": (
        "function ready(input: string) { if (input) { return true; } else { return false; } }",
        "function ready(input: string) { if (input) { record(); return true; } else { return false; } }",
    ),
    "ts-identical-ternary-branches": (
        "const value = input ? result : result;",
        "const value = input ? first : second;",
    ),
    "ts-nested-if": (
        "if (first) { if (second) { work(); } }",
        "if (first) { if (second) { work(); } else { recover(); } }",
    ),
    "ts-double-assertion": (
        "const value = input as unknown as Result;",
        "const value = input satisfies Result;",
    ),
    "ts-explicit-any": (
        "function work(value: any) { return value; }",
        "function work(value: unknown) { return value; }",
    ),
    "ts-non-null-assertion": (
        "const value = input!.name;",
        "const value = input?.name;",
    ),
}


@pytest.mark.integration
@pytest.mark.parametrize("suffix", [".ts", ".tsx", ".mts", ".cts"])
def test_typescript_rules_match_syntax_and_preserve_valid_cases(
    tmp_path: Path, suffix: str
) -> None:
    """The real packaged matcher must distinguish both sides of each rule."""
    expected: set[tuple[str, str]] = set()
    files: list[Path] = []
    for rule_id, (invalid, valid) in _CASES.items():
        for label, source in (("invalid", invalid), ("valid", valid)):
            path = tmp_path / f"{rule_id}-{label}{suffix}"
            path.write_text(source, encoding="utf-8")
            files.append(path)
            if label == "invalid":
                expected.add((path.name, rule_id))
    with rules_file() as rules:
        hits = run_sg(tuple(files), rules)
    actual = {(hit.file.name, hit.rule_id) for hit in hits}
    assert actual == expected


@pytest.mark.integration
@pytest.mark.parametrize(
    "directive",
    [
        "// scbc boundary: decode external data",
        "// scbc ignore[ts-catch-static-fallback]",
    ],
)
def test_typescript_suppressions_filter_real_findings(
    tmp_path: Path, directive: str
) -> None:
    """Boundary and line directives suppress only the intended finding."""
    path = tmp_path / "parse.tsx"
    path.write_text(
        f"""function parse(s: string) {{
{directive}
try {{ return JSON.parse(s); }} catch {{ return {{}}; }}
}}
const visible = flag ? true : false;
""",
        encoding="utf-8",
    )

    result = analyze_files((path,))
    hits = result.flags.findings.ast_grep_hits

    assert [hit.rule_id for hit in hits] == ["ts-boolean-ternary"]
    all_result = analyze_files((path,), include_all=True)
    assert {hit.rule_id for hit in all_result.flags.findings.ast_grep_hits} == {
        "ts-boolean-ternary",
        "ts-catch-static-fallback",
    }
