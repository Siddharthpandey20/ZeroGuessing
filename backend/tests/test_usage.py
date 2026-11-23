"""Token accounting: each model call's billed usage lands on the answer's meter, including calls made in tasks the
answer pipeline spawns (the contradiction check runs in parallel) and calls whose JSON turned out malformed."""

import asyncio
from types import SimpleNamespace

from pydantic import BaseModel

from app.llm import usage
from app.llm.gemini import GeminiClient
from scripts.run_eval import tokens_summary


def _meta(i: int, o: int, t: int | None = None, c: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(prompt_token_count=i, candidates_token_count=o, thoughts_token_count=t,
                           cached_content_token_count=c)


async def _in_fresh_context(fn):
    """Run in its own task so one test's meter never leaks into another's."""
    return await asyncio.create_task(fn())


async def test_meter_sums_calls_and_treats_missing_counts_as_zero():
    async def run():
        m = usage.start()
        usage.record("Draft", "flash", _meta(2600, 120, 1100, 0))
        usage.record("JudgeOut", "flash", _meta(470, 100))  # no thinking/cache fields reported
        usage.record("x", "flash", None)  # a response without usage metadata
        return m.summary()

    s = await _in_fresh_context(run)
    assert (s["input"], s["output"], s["thinking"], s["cached"]) == (3070, 220, 1100, 0)
    assert s["total"] == 3070 + 220 + 1100
    assert [c["call"] for c in s["calls"]] == ["Draft", "JudgeOut", "x"]


async def test_calls_in_spawned_tasks_reach_the_same_meter():
    async def run():
        m = usage.start()

        async def side():  # like confirm_pairs(), started with asyncio.create_task
            usage.record("ContraOut", "flash", _meta(300, 50, 200))

        await asyncio.create_task(side())
        return m.summary()

    s = await _in_fresh_context(run)
    assert s["input"] == 300 and s["thinking"] == 200


async def test_no_open_meter_only_returns_counts():
    async def run():
        return usage.record("AmendOut", "flash", _meta(10, 5, 1))

    assert await _in_fresh_context(run) == {"input": 10, "output": 5, "thinking": 1, "cached": 0}


async def test_generate_json_records_usage_including_a_malformed_attempt():
    class Out(BaseModel):
        ok: bool

    replies = iter(['{"ok": ', '{"ok": true}'])  # first reply is broken JSON: still billed

    class Models:
        async def generate_content(self, model, contents, config):
            return SimpleNamespace(text=next(replies), usage_metadata=_meta(100, 10, 40))

    c = object.__new__(GeminiClient)
    c.client = SimpleNamespace(aio=SimpleNamespace(models=Models()))
    c.models, c.timeout, c.thinking = ["flash"], 5.0, ""

    async def run():
        m = usage.start()
        assert (await c.generate_json(Out, "p", "s")).ok
        return m.summary()

    s = await _in_fresh_context(run)
    assert len(s["calls"]) == 2
    assert (s["input"], s["output"], s["thinking"]) == (200, 20, 80)


def test_eval_summary_ignores_cache_hits_and_old_servers():
    rows = [
        {"cached": False, "tokens_input": 3000, "tokens_output": 200, "tokens_thinking": 1800, "tokens_cached": 0, "tokens_total": 5000},
        {"cached": False, "tokens_input": 1000, "tokens_output": 100, "tokens_thinking": 900, "tokens_cached": 0, "tokens_total": 2000},
        {"cached": True, "tokens_input": 0, "tokens_output": 0, "tokens_thinking": 0, "tokens_cached": 0, "tokens_total": 0},
    ]
    s = tokens_summary(rows)
    assert s["tokens_per_q_total"] == 3500 and s["tokens_per_q_input"] == 2000
    assert s["tokens_run"]["total"] == 7000
    assert tokens_summary([{"cached": False, "tokens_total": None}]) == {}
