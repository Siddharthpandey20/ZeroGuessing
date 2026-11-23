"""Token accounting: what the model provider billed, per call, added up per answer.

answer_question() opens a meter; every generate_json/read_image call made while answering (including the
contradiction check, which runs in its own task: tasks copy the context, so they share the same meter object) adds the
`usage_metadata` Gemini returned. Calls made with no meter open (ingestion, chat naming) are only logged.

Thinking tokens are billed as output, so `output` here is visible output only and `thinking` is listed separately.
"""

from contextvars import ContextVar
from dataclasses import dataclass, field

_FIELDS = {"input": "prompt_token_count", "output": "candidates_token_count",
           "thinking": "thoughts_token_count", "cached": "cached_content_token_count"}


def counts(usage_metadata: object) -> dict[str, int]:
    """input / output / thinking / cached token counts from a Gemini response (missing or None -> 0)."""
    return {k: int(getattr(usage_metadata, f, None) or 0) for k, f in _FIELDS.items()}


@dataclass
class Meter:
    calls: list[dict] = field(default_factory=list)

    def add(self, call: str, model: str, usage_metadata: object) -> dict[str, int]:
        c = counts(usage_metadata)
        self.calls.append({"call": call, "model": model, **c})
        return c

    def summary(self) -> dict:
        tot = {k: sum(c[k] for c in self.calls) for k in _FIELDS}
        return {**tot, "total": tot["input"] + tot["output"] + tot["thinking"], "calls": list(self.calls)}


_meter: ContextVar[Meter | None] = ContextVar("llm_meter", default=None)


def start() -> Meter:
    """Open a fresh meter for the current task (and the tasks it creates from now on)."""
    m = Meter()
    _meter.set(m)
    return m


def record(call: str, model: str, usage_metadata: object) -> dict[str, int]:
    """Add one model call to the open meter, if any. Returns its counts (for logging)."""
    m = _meter.get()
    return m.add(call, model, usage_metadata) if m is not None else counts(usage_metadata)
