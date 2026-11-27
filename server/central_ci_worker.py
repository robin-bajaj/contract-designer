"""Run queued PR validation jobs in a separately deployed isolated worker.

Usage: python -m server.central_ci_worker --once
       python -m server.central_ci_worker --loop

Run this worker inside an isolated ephemeral container/VM, not on the
public-facing portal API server. Worker needs dbt, CDO compiler and scoped
warehouse credentials. Check Runs are created by the centrally installed App.
"""
from __future__ import annotations
import argparse
import time
from . import central_ci_queue, github_app_ci


def process_one(*, execute=github_app_ci.execute_event) -> bool:
    event = central_ci_queue.claim_one()
    if event is None:
        return False
    try:
        result = execute(event)
    except Exception:
        result = {"ok": False, "error": "Central CI worker could not complete validation or GitHub reporting"}
    central_ci_queue.finish(event["id"], result)
    return True


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--once", action="store_true")
    group.add_argument("--loop", action="store_true")
    args = parser.parse_args()
    if args.once:
        process_one()
    else:
        while True:
            if not process_one():
                time.sleep(3)


if __name__ == "__main__":
    main()
