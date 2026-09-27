"""`ofp-export view`, against the examples the pinned submodule ships.

The page itself is exercised in the browser tests (web/tests/e2e/single.spec.ts,
which also opens files this command wrote). What is checked here is the
command's own job: finding the documents, deciding what to refuse or warn
about, and putting the text into the template unchanged.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from ofplang.export.cli import EXIT_INPUT, EXIT_OK, EXIT_REFUSED, main
from ofplang.export.template import CONTRACT, TemplateError, embed, encode

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "external" / "ofplang-schedule" / "examples"
OUTPUTS = EXAMPLES / "outputs"

# A template is anything carrying the one element of the contract (design.md D48).
TEMPLATE = (
    '<!doctype html><html><head><meta name="ofp-viewer-build" content="abc1234" />'
    f'<script type="application/json" id="ofp-documents" data-contract="{CONTRACT}">null</script>'
    "</head><body></body></html>"
)

pytestmark = pytest.mark.skipif(not EXAMPLES.is_dir(), reason="the submodule is not checked out")


@pytest.fixture
def template(tmp_path: Path) -> Path:
    path = tmp_path / "viewer.html"
    path.write_text(TEMPLATE, encoding="utf-8")
    return path


def payload_of(html: str) -> dict | None:
    m = re.search(r'id="ofp-documents" data-contract="\d+">(.*?)</script>', html, re.DOTALL)
    assert m, "the element is gone"
    return json.loads(m.group(1))


def run(capsys, *args: str) -> tuple[int, str, str]:
    code = main(["view", *args])
    out, err = capsys.readouterr()
    return code, out, err


# ── what goes in ───────────────────────────────────────────────────────────


def test_a_plan_brings_its_workflow_and_environment_from_meta(tmp_path, template, capsys):
    # reroute_chain's replan runs on simple.workflow.yaml: matching by file
    # name would miss it; `meta` names it (design.md D32).
    out = tmp_path / "rc.html"
    code, stdout, _ = run(
        capsys, str(OUTPUTS / "reroute_chain.replan.yaml"), "-o", str(out), "--template", str(template)
    )
    assert code == EXIT_OK
    assert stdout.strip() == str(out)
    p = payload_of(out.read_text(encoding="utf-8"))
    assert p["name"] == "reroute_chain.replan.yaml"
    assert p["workflow"] == (EXAMPLES / "simple.workflow.yaml").read_text(encoding="utf-8")
    assert p["environment"] == (EXAMPLES / "reroute_chain.env.yaml").read_text(encoding="utf-8")


def test_files_in_any_order_and_what_was_given_wins_over_meta(tmp_path, template, capsys):
    out = tmp_path / "x.html"
    other = EXAMPLES / "two_arms.workflow.yaml"
    code, _, _ = run(
        capsys, str(other), str(OUTPUTS / "simple.plan.yaml"), "-o", str(out), "--template", str(template)
    )
    assert code == EXIT_OK
    assert payload_of(out.read_text(encoding="utf-8"))["workflow"] == other.read_text(encoding="utf-8")


def test_no_follow_takes_only_what_was_given(tmp_path, template, capsys):
    out = tmp_path / "x.html"
    run(capsys, str(OUTPUTS / "simple.plan.yaml"), "--no-follow", "-o", str(out), "--template", str(template))
    p = payload_of(out.read_text(encoding="utf-8"))
    assert "workflow" not in p and "environment" not in p


def test_a_workflow_alone(tmp_path, template, capsys):
    out = tmp_path / "wf.html"
    code, _, _ = run(
        capsys, str(EXAMPLES / "reformatter.workflow.yaml"), "-o", str(out), "--template", str(template)
    )
    assert code == EXIT_OK
    p = payload_of(out.read_text(encoding="utf-8"))
    assert set(p) == {"name", "workflow"}


def test_the_opening_view_is_carried_only_when_asked(tmp_path, template, capsys):
    out = tmp_path / "x.html"
    run(
        capsys,
        str(OUTPUTS / "plate_batch.plan.yaml"),
        "--layout",
        "plan",
        "--gantt",
        "flow",
        "-o",
        str(out),
        "--template",
        str(template),
    )
    assert payload_of(out.read_text(encoding="utf-8"))["ui"] == {"layout": "plan", "view": "flow"}
    run(capsys, str(OUTPUTS / "plate_batch.plan.yaml"), "-o", str(out), "--template", str(template))
    assert "ui" not in payload_of(out.read_text(encoding="utf-8"))


# ── the text arrives unchanged ─────────────────────────────────────────────


def test_text_that_would_end_the_element_is_escaped_losslessly():
    text = "a: 1  # </script><b>x</b> $1 \\g<0> 日本語\n"
    html = embed(TEMPLATE, {"name": "t", "workflow": text})
    assert "</script><b>" not in html
    assert html.count("</script>") == 1
    assert payload_of(html)["workflow"] == text


def test_encode_null_is_an_empty_viewer():
    assert encode(None) == "null"
    assert payload_of(embed(TEMPLATE, None)) is None


def test_a_template_without_the_element_or_of_another_contract_is_refused():
    with pytest.raises(TemplateError, match="no #ofp-documents"):
        embed("<html></html>", {"name": "x"})
    with pytest.raises(TemplateError, match="contract 9"):
        embed(TEMPLATE.replace(f'data-contract="{CONTRACT}"', 'data-contract="9"'), {"name": "x"})


# ── refused, warned, wrong ─────────────────────────────────────────────────


@pytest.mark.parametrize("plan", ["shared_bay.plan.yaml", "shared_refill.plan.yaml", "stopped_job.plan.yaml"])
def test_a_joint_plan_is_refused_and_nothing_is_written(tmp_path, template, capsys, plan):
    out = tmp_path / "j.html"
    code, stdout, err = run(
        capsys, str(OUTPUTS / plan), "-o", str(out), "--template", str(template), "--json"
    )
    assert code == EXIT_REFUSED
    assert not out.exists()
    assert "section 6.11" in err
    summary = json.loads(stdout)
    assert summary["written"] is None and summary["refused"]


def test_a_workflow_drawn_only_in_part_is_written_with_a_warning(tmp_path, template, capsys):
    wf = tmp_path / "mapped.workflow.yaml"
    wf.write_text(
        (EXAMPLES / "reformatter.workflow.yaml").read_text(encoding="utf-8")
        + "\nx-extra:\n  $import: other.yaml\n",
        encoding="utf-8",
    )
    out = tmp_path / "m.html"
    code, stdout, err = run(capsys, str(wf), "-o", str(out), "--template", str(template), "--json")
    assert code == EXIT_OK and out.exists()
    assert "warning: $import" in err
    assert json.loads(stdout)["warnings"][0]["what"] == "$import"


@pytest.mark.parametrize(
    ("args", "message"),
    [
        (["nope.yaml"], "no such file"),
        ([str(EXAMPLES / "simple.env.yaml")], "nothing to draw"),
        ([str(OUTPUTS / "simple.plan.yaml"), str(OUTPUTS / "two_arms.plan.yaml")], "two plan documents"),
        ([str(EXAMPLES / "reformatter.workflow.yaml"), "--json"], "--json needs -o"),
    ],
)
def test_bad_input_is_exit_2_with_a_message(template, capsys, args, message):
    code, _, err = run(capsys, *args, "--template", str(template))
    assert code == EXIT_INPUT
    assert message in err


def test_a_file_that_is_no_document(tmp_path, template, capsys):
    junk = tmp_path / "junk.yaml"
    junk.write_text("just: a mapping\n", encoding="utf-8")
    code, _, err = run(capsys, str(junk), "--template", str(template))
    assert code == EXIT_INPUT and "not a plan, a workflow or an environment" in err


# ── where it goes ──────────────────────────────────────────────────────────


def test_without_o_the_html_goes_to_standard_output(template, capsysbinary):
    code = main(["view", str(EXAMPLES / "reformatter.workflow.yaml"), "--template", str(template)])
    out = capsysbinary.readouterr().out.decode("utf-8")
    assert code == EXIT_OK
    assert out.startswith("<!doctype html>")
    assert payload_of(out)["name"] == "reformatter.workflow.yaml"


def test_the_json_summary(tmp_path, template, capsys):
    out = tmp_path / "s.html"
    code, stdout, _ = run(
        capsys, str(OUTPUTS / "plate_batch.plan.yaml"), "-o", str(out), "--template", str(template), "--json"
    )
    s = json.loads(stdout)
    assert code == EXIT_OK
    assert s["written"] == str(out.resolve())
    assert s["activities"] == 44 and s["outcome"] == "optimal"
    assert s["template_build"] == "abc1234"
    assert all(s["documents"][k] for k in ("plan", "workflow", "environment"))
