"""embed() must return one vector per input text.

gemini-embedding-2 treats a plain list of strings as ONE multi-part input and returns ONE embedding for it, so a
batch of 30 chunks used to come back as a single vector and only the first chunk of every document was embedded.
The fake client below behaves like the real API in that respect (checked against it on 2026-11-23)."""

from types import SimpleNamespace

import numpy as np
import pytest

from app.llm.gemini import GeminiClient, LLMError


class _AggregatingModels:
    """Like gemini-embedding-2: each Content object -> one embedding; plain strings -> one embedding in total."""

    def __init__(self, drop_one: bool = False) -> None:
        self.drop_one = drop_one

    async def embed_content(self, model, contents, config):
        n = 1 if isinstance(contents, str) or all(isinstance(c, str) for c in contents) else len(contents)
        n -= self.drop_one
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[float(i + 1), 1.0, 0.0]) for i in range(n)])


def _client(models: _AggregatingModels) -> GeminiClient:
    c = object.__new__(GeminiClient)  # skip __init__: no API key or network in tests
    c.client = SimpleNamespace(aio=SimpleNamespace(models=models))
    c.embed_model, c.dim, c.timeout = "gemini-embedding-2", 3, 5.0
    return c


async def test_one_vector_per_text():
    vecs = await _client(_AggregatingModels()).embed([f"chunk {i}" for i in range(30)])
    assert len(vecs) == 30
    assert np.allclose(np.linalg.norm(np.array(vecs), axis=1), 1.0)


async def test_a_stalled_model_hands_over_after_one_timeout():
    """A timeout moves to the next model at once (it used to retry the stalled one 3x: minutes per answer)."""
    import asyncio
    import time

    from pydantic import BaseModel

    class Out(BaseModel):
        ok: bool

    calls: list[str] = []

    class Models:
        async def generate_content(self, model, contents, config):
            calls.append(model)
            if model == "slow":
                await asyncio.sleep(10)
            return SimpleNamespace(text='{"ok": true}')

    c = object.__new__(GeminiClient)
    c.client = SimpleNamespace(aio=SimpleNamespace(models=Models()))
    c.models, c.timeout, c.thinking = ["slow", "fast"], 0.05, ""
    t0 = time.perf_counter()
    assert (await c.generate_json(Out, "p", "s")).ok
    assert calls == ["slow", "fast"]
    assert time.perf_counter() - t0 < 1


async def test_short_response_is_an_error_not_silent_truncation():
    with pytest.raises(LLMError):
        await _client(_AggregatingModels(drop_one=True)).embed(["a", "b", "c"])
