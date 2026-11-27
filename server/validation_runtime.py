"""Command runner isolated from the portal HTTP handler (avoids import cycles)."""
from __future__ import annotations
import subprocess
from pathlib import Path


class StepFailure(RuntimeError):
    def __init__(self, step: str, output: str):
        self.step = step
        self.output = output
        super().__init__(f"{step}: {output}")


def run_command(step: str, argv: list[str], cwd: Path, env: dict | None = None, timeout: int = 90) -> str:
    try:
        result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True,
                                text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise StepFailure(step, f"Timed out after {timeout}s") from exc
    except OSError as exc:
        raise StepFailure(step, f"Cannot execute command: {exc}") from exc
    output = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
    if result.returncode != 0:
        raise StepFailure(step, output[-12000:] or f"Exit code {result.returncode}")
    return output[-12000:]
