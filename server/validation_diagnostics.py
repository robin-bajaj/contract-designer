"""Portable dbt validation diagnostics: no hardcoded team or model names."""
from __future__ import annotations
import re

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def diagnose(log: str) -> list[dict]:
    clean = ANSI.sub("", log or "")
    result: list[dict] = []

    for match in re.finditer(r'dbt found two metrics with the name ["\']([^"\']+)["\']', clean, re.I):
        field = match.group(1)
        result.append({
            "code": "duplicate-metric", "field": field,
            "message": f"Metric '{field}' is already defined by another semantic model in the connected dbt project. Use a unique team-facing metric name or edit the existing model.",
        })

    # MetricFlow emits one warning per model for a shared element with
    # different semantic kinds. Aggregate those warnings into one diagnostic.
    conflicts: dict[str, set[str]] = {}
    for match in re.finditer(
        r"In semantic models \{'([^']+)'\}, element `([^`]+)` is of type "
        r"SemanticModelElementType\.([A-Z_]+), but it is used as types",
        clean,
    ):
        model, field = match.group(1), match.group(2)
        conflicts.setdefault(field, set()).add(model)
    for field, models in conflicts.items():
        result.append({
            "code": "semantic-element-conflict", "field": field,
            "models": sorted(models),
            "message": f"'{field}' has conflicting entity/dimension classifications across semantic models: {', '.join(sorted(models))}. Align the semantic definitions at the contract/source level; do not bypass dbt validation.",
        })

    pairing = re.search(
        r"Duplicate dimension \+ primary entity pairing detected.*?Semantic model `([^`]+)`.*?"
        r"primary entity of `([^`]+)` and dimension `([^`]+)`.*?"
        r"already in use on semantic model `([^`]+)`",
        clean, re.S,
    )
    if pairing:
        model, entity, dimension, other = pairing.groups()
        result.append({
            "code": "duplicate-entity-dimension", "field": dimension,
            "models": [model, other],
            "message": f"Primary entity '{entity}' and dimension '{dimension}' are duplicated in '{model}' and '{other}'. Reuse the existing semantic model or define a genuinely distinct grain.",
        })
    return result
