"""Validated team identifiers and folder names; shared by every portal workflow."""
import re

ROLE = re.compile(r"^team-[a-z][a-z0-9-]{0,48}$")


def is_team(role: object) -> bool:
    return isinstance(role, str) and bool(ROLE.fullmatch(role))


def folder(role: str) -> str:
    if not is_team(role):
        raise ValueError("Invalid team identifier")
    return role.replace("-", "_")
