from pathlib import Path

import pytest

from scb_check.analysis.clones import detect_clones
from scb_check.config import Config
from scb_check.models import AstGrepHit
from scb_check.pipeline import analyze
from scb_check.pipeline import analyze_files
from scb_check.reporting.score import compute_report
from scb_check.tree_walking.artifacts import ProjectParseError
from scb_check.tree_walking.directives import IgnoreDirectiveError
from scb_check.tree_walking.directives import parse_ignore_directives
from scb_check.tree_walking.dispatch import parse_source_file
from scb_check.tree_walking.models import Language


@pytest.mark.parametrize("suffix", [".ts", ".tsx", ".mts", ".cts"])
def test_typescript_variants_are_scanned(tmp_path: Path, suffix: str) -> None:
    """Typed JavaScript variants participate in the same function metrics."""
    path = tmp_path / f"view{suffix}"
    value = "<span>{value}</span>" if suffix == ".tsx" else "<number>value"
    path.write_text(f"const view = (value: number) => {value};\n")

    result = analyze(
        tmp_path, Config(exclude=(), base_dir=tmp_path), disable_sg=True
    )

    assert result.flags.lines.total_loc_by_file == ((path, 1),)
    assert len(result.flags.findings.all_functions) == 1
    assert result.flags.syntax_by_language[0].language is Language.TYPESCRIPT


def test_tsx_clones_cover_executable_bodies(tmp_path: Path) -> None:
    """JSX output does not prevent duplicate body detection."""
    source = "const View = (value: number) => {\nconst label = value + 1;\nreturn <span>{label}</span>;\n};"
    files = tuple(
        parse_source_file(tmp_path / name, source)
        for name in ("a.tsx", "b.tsx")
    )

    clones = detect_clones(files)

    assert clones
    assert {clone.file.name for clone in clones} == {"a.tsx", "b.tsx"}


def test_typescript_function_expressions_contribute_complexity(tmp_path: Path) -> None:
    """A named function expression must count alongside arrows and declarations."""
    parsed = parse_source_file(
        tmp_path / "compute.ts",
        "const compute = function(value: number) { if (value > 0) return value + 1; return 0; };",
    )

    assert len(parsed.module.symbols) == 1
    function = parsed.module.symbols[0]
    assert function.name == "compute"
    assert function.cyc_complexity == 2


def test_typescript_rule_hits_contribute_to_verbosity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """TypeScript rule hits reach the shared line union and score."""
    path = tmp_path / "example.tsx"
    path.write_text(
        "const yes = ready ? true : false;\nconst View = () => <div/>;\n"
    )
    hit = AstGrepHit(
        file=path,
        line=1,
        end_line=1,
        col=0,
        end_col=31,
        rule_id="ts-boolean-ternary",
        matched_text="ready ? true : false",
        message="Review boolean conversion.",
    )

    def scan(files: tuple[Path, ...], _rules: Path) -> tuple[AstGrepHit, ...]:
        return (hit,) if path in files else ()

    monkeypatch.setattr("scb_check.pipeline.run_sg", scan)
    report = compute_report(analyze_files((path,)).flags)

    assert report.verbosity_summary.ast_grep_flagged_loc == 1
    assert report.scores.verbosity == 0.5


@pytest.mark.parametrize(
    "comment",
    [
        "// scbc ignore[ts-boolean-ternary]",
        "/* scbc ignore[ts-boolean-ternary] */",
        "/*\n * scbc ignore[ts-boolean-ternary]\n */",
    ],
)
def test_typescript_comment_ignores_target_code(
    tmp_path: Path, comment: str
) -> None:
    """Both comment forms suppress the next executable source line."""
    source = comment + "\n\nconst result = condition ? true : false;\n"
    directives = parse_ignore_directives(
        {tmp_path / "a.ts": source},
        valid_rule_ids=frozenset({"ts-boolean-ternary"}),
    )

    assert len(directives) == 1
    assert directives[0].target_line == len(comment.splitlines()) + 2


def test_typescript_directive_text_in_literals_is_ignored(
    tmp_path: Path,
) -> None:
    """Strings, regexes and JSX text cannot disable lint findings."""
    source = """const a = "// scbc ignore[bad]";
const b = `/* scbc ignore[bad] */`;
const c = /scbc ignore[bad]/;
const View = () => <span>scbc ignore[bad]</span>;
"""
    assert (
        parse_ignore_directives(
            {tmp_path / "view.tsx": source}, valid_rule_ids=frozenset()
        )
        == ()
    )


def test_typescript_unknown_directive_is_rejected(tmp_path: Path) -> None:
    """Misspelled rule IDs produce an actionable error."""
    with pytest.raises(
        IgnoreDirectiveError, match="unknown rule id: misspelled"
    ):
        parse_ignore_directives(
            {tmp_path / "a.ts": "// scbc ignore[misspelled]\nconst a = 1;"},
            valid_rule_ids=frozenset(),
        )


def test_tsx_attributes_preserve_entities(tmp_path: Path) -> None:
    """JSX attribute text remains part of the parsed component."""
    source = 'const Link = () => <link href="https://example.com/?a=1&amp;family=Font:wght@400;500&amp;display=swap" />;'
    parsed = parse_source_file(tmp_path / "link.tsx", source)

    assert parsed.module.sloc_lines == frozenset({1})
    assert [symbol.name for symbol in parsed.module.symbols] == ["Link"]


@pytest.mark.parametrize(
    "source",
    [
        'const Link = () => <link href="unclosed />;',
        'const Link = () => { const broken = ; return <link href="a&b;c"/>; };',
        "const Link = () => <link href={value + } />;",
    ],
)
def test_tsx_code_errors_remain_errors(tmp_path: Path, source: str) -> None:
    """Syntax errors in JSX and function bodies must fail the parse."""
    with pytest.raises(ProjectParseError):
        parse_source_file(tmp_path / "broken.tsx", source)
