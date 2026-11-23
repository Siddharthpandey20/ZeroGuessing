"""The only module that talks to a model provider (swap point if judges require local models).

generate_json(): schema-constrained JSON -> validated Pydantic object, with retry + model fallback.
embed(): batched embeddings, L2-normalised (needed for truncated Gemini dims).
"""

import asyncio
import logging
import time
from typing import Protocol, TypeVar

import numpy as np
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.llm import usage

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

_RETRYABLE = {429, 500, 502, 503, 504}


class LLMError(RuntimeError):
    pass


class GeminiClient:
    def __init__(self) -> None:
        s = get_settings()
        if not s.gemini_api_key:
            raise LLMError("GEMINI_API_KEY is not set")
        self.client = genai.Client(api_key=s.gemini_api_key)
        self.models = [s.gemini_model, *s.fallback_models]
        self.embed_model = s.gemini_embed_model
        self.dim = s.embed_dim
        self.timeout = s.llm_timeout_s
        self.thinking = s.llm_thinking

    async def generate_json(
        self, schema: type[T], prompt: str, system: str, *, temperature: float = 0.0, attempts: int = 3,
        thinking: str | None = None,
    ) -> T:
        level = (thinking if thinking is not None else self.thinking).strip().upper()
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=schema,
            thinking_config=types.ThinkingConfig(thinking_level=level) if level else None,
        )
        last: Exception | None = None
        for model in self.models:
            for attempt in range(attempts):
                t0 = time.perf_counter()
                try:
                    resp = await asyncio.wait_for(
                        self.client.aio.models.generate_content(model=model, contents=prompt, config=config),
                        timeout=self.timeout,
                    )
                    # billed even if the JSON turns out malformed: count before validating
                    tok = usage.record(schema.__name__, model, getattr(resp, "usage_metadata", None))
                    out = schema.model_validate_json(resp.text or "")
                    log.info("llm ok model=%s schema=%s ms=%d tokens in=%d out=%d think=%d cached=%d", model,
                             schema.__name__, (time.perf_counter() - t0) * 1000,
                             tok["input"], tok["output"], tok["thinking"], tok["cached"])
                    return out
                except ValidationError as e:  # malformed JSON: one more try on same model, then move on
                    last = e
                    log.warning("llm invalid json model=%s attempt=%d", model, attempt)
                    if attempt >= 1:
                        break
                except errors.APIError as e:
                    last = e
                    log.warning("llm api error model=%s code=%s attempt=%d", model, e.code, attempt)
                    if e.code == 404:  # model id not available for this key -> next model
                        break
                    if e.code not in _RETRYABLE:
                        raise LLMError(str(e)) from e
                    await asyncio.sleep(min(2**attempt, 8))
                except TimeoutError as e:
                    # a stalled model rarely recovers within seconds: try the next one instead of waiting again
                    last = e
                    log.warning("llm timeout model=%s attempt=%d", model, attempt)
                    break
        raise LLMError(f"all models failed: {last}")

    async def read_image(self, data: bytes, mime: str) -> str:
        """Camera input: transcribe the text in a photo (question or printed clause). Returned for user editing."""
        prompt = ("Transcribe all text in this image exactly as printed, preserving numbers, %, ₹ amounts, dates and "
                  "clause numbers. Output only the text.")
        last: Exception | None = None
        for model in self.models:
            try:
                resp = await asyncio.wait_for(self.client.aio.models.generate_content(
                    model=model, contents=[types.Part.from_bytes(data=data, mime_type=mime), prompt],
                    config=types.GenerateContentConfig(temperature=0)), timeout=self.timeout)
                usage.record("read_image", model, getattr(resp, "usage_metadata", None))
                return (resp.text or "").strip()
            except (errors.APIError, TimeoutError) as e:
                last = e
        raise LLMError(f"image read failed: {last}")

    async def embed(self, texts: list[str], task: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), 100):
            batch = texts[i : i + 100]
            for attempt in range(4):
                try:
                    resp = await asyncio.wait_for(self.client.aio.models.embed_content(
                        model=self.embed_model,
                        # one Content per text: gemini-embedding-2 merges a plain list of strings into ONE embedding
                        contents=[types.Content(parts=[types.Part(text=t)]) for t in batch],
                        config=types.EmbedContentConfig(task_type=task, output_dimensionality=self.dim),
                    ), timeout=self.timeout)
                    break
                except errors.APIError as e:
                    if e.code not in _RETRYABLE or attempt == 3:
                        raise LLMError(str(e)) from e
                    await asyncio.sleep(2**attempt)
                except TimeoutError as e:
                    if attempt >= 1:  # a question's embedding is waited on: fail over to keyword search, don't hang
                        raise LLMError(f"embedding timed out after {self.timeout:.0f}s") from e
            if len(resp.embeddings) != len(batch):  # never hand back fewer vectors than texts: callers zip them
                raise LLMError(f"embedding model returned {len(resp.embeddings)} vectors for {len(batch)} texts")
            vecs = np.array([e.values for e in resp.embeddings], dtype=np.float32)
            vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-12
            out.extend(vecs.tolist())
        return out

    async def embed_query(self, text: str) -> list[float]:
        return (await self.embed([text], task="RETRIEVAL_QUERY"))[0]


class LLM(Protocol):
    async def generate_json(self, schema: type[T], prompt: str, system: str, *, temperature: float = 0.0,
                            thinking: str | None = None) -> T: ...
    async def embed(self, texts: list[str], task: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]: ...
    async def embed_query(self, text: str) -> list[float]: ...
    async def read_image(self, data: bytes, mime: str) -> str: ...


_client: LLM | None = None


def get_llm() -> LLM:
    global _client
    if _client is None:
        _client = GeminiClient()
    return _client


def set_llm(client: LLM | None) -> None:
    """Swap the provider (tests use a fake; a local-model client can be plugged in here)."""
    global _client
    _client = client
