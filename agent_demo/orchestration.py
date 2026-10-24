"""Small, audited supervisory state machine for the workshop manager.

The manager LLM proposes the next assignment; these host-side rules validate it.
Flow (test-first): Architect -> QA writes tests -> Backend + Frontend (either order)
-> QA runs tests -> COMPLETE, or one bounded correction, or STOP.
This is deliberately a bounded supervised pattern, not CrewAI Process.hierarchical.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

WORKERS = ("Architect", "QA", "Backend", "Frontend")
DEVELOPERS = ("Backend", "Frontend")


def parse_decision(text: str) -> dict:
    """Require manager-produced JSON, tolerate Markdown code fences and surrounding text, but not invented defaults."""
    source = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", source, flags=re.I | re.S)
    if fenced:
        source = fenced.group(1).strip()
    else:
        brace_match = re.search(r"\{[^{}]*\"assign\"[^{}]*\}", source, flags=re.S)
        if brace_match:
            source = brace_match.group(0).strip()
        elif source.startswith("```"):
            inner = re.sub(r"^```(?:json)?\s*", "", source, flags=re.I)
            inner = re.sub(r"\s*```$", "", inner)
            source = inner.strip()
    obj = json.loads(source)
    if not isinstance(obj, dict) or not isinstance(obj.get("assign"), str):
        raise ValueError('Manager must return JSON with string field "assign"')
    if not isinstance(obj.get("reason"), str) or not obj["reason"].strip():
        raise ValueError('Manager must provide a non-empty "reason"')
    if len(obj["reason"]) > 500:
        raise ValueError("Manager reason exceeds maximum length")
    return {"assign": obj["assign"], "reason": obj["reason"].strip()}


@dataclass
class SupervisorState:
    completed: set[str] = field(default_factory=set)   # which workers finished
    tests_written: bool = False                       # QA wrote failing tests yet?
    feasible: bool | None = None                      # Architect's verdict
    qa_passed: bool | None = None                     # last QA run result
    retry_count: int = 0                              # corrections used
    retry_worker: str | None = None                   # who is fixing right now
    max_corrections: int = 1                          # budget (set once, never changes)
    closed: bool = False                              # run finished

    def allowed(self) -> list[str]:
        if self.closed:
            return []
        if "Architect" not in self.completed:
            return ["Architect"]
        if self.feasible is False:
            return ["STOP"]
        if not self.tests_written:
            return ["QA"]
        remaining = [name for name in DEVELOPERS if name not in self.completed]
        if remaining:
            return remaining
        if "QA" not in self.completed or self.retry_worker:
            return ["QA"]
        if self.qa_passed:
            return ["COMPLETE"]
        if self.retry_count < self.max_corrections:
            return [*DEVELOPERS, "STOP"]
        return ["STOP"]

    @property
    def phase(self) -> str:
        """What a QA assignment means right now: write the tests, or run them."""
        return "write_tests" if not self.tests_written else "run_tests"

    def validate(self, proposed: dict) -> str:
        choice = proposed.get("assign")
        allowed = self.allowed()
        if choice not in allowed:
            raise ValueError(f"Manager requested {choice!r}; allowed actions at this point: {allowed}")
        return choice

    def mark_finished(self, role: str, *, qa_passed: bool | None = None, feasible: bool | None = None) -> None:
        if role not in WORKERS:
            raise ValueError(f"Not a worker: {role}")
        if role == "Architect":
            if feasible is None:
                raise ValueError("Architect must report whether the feature is feasible")
            self.feasible = feasible
            self.completed.add(role)
        elif role == "QA" and not self.tests_written:
            if qa_passed is not None:
                raise ValueError("QA writes tests before any code exists; there is no result yet")
            self.tests_written = True
        elif role == "QA":
            if qa_passed is None:
                raise ValueError("QA must report an actual test result")
            self.qa_passed = qa_passed
            self.completed.add(role)
            self.retry_worker = None
        elif role in self.completed:  # a developer's correction after failed QA
            if self.retry_count >= self.max_corrections or self.qa_passed is not False:
                raise ValueError("Unexpected developer retry")
            self.retry_count += 1
            self.retry_worker = role
            self.completed.discard("QA")
            self.qa_passed = None
        else:
            self.completed.add(role)

    def close(self, outcome: str) -> None:
        if outcome == "COMPLETE" and not self.qa_passed:
            raise ValueError("Cannot close successfully without passing QA")
        if outcome not in {"COMPLETE", "STOP"}:
            raise ValueError(f"Unexpected closure: {outcome}")
        self.closed = True

    def snapshot(self) -> dict:
        return {"completed": sorted(self.completed), "tests_written": self.tests_written,
                "feasible": self.feasible, "qa_passed": self.qa_passed,
                "retry_count": self.retry_count, "retry_worker": self.retry_worker,
                "max_corrections": self.max_corrections,
                "allowed_next": self.allowed(), "closed": self.closed}
