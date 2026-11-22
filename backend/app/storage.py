"""File storage: local disk for dev, GCS for Cloud Run (no persistent disk there)."""

from pathlib import Path
from typing import Protocol

from app.config import get_settings


class Storage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...


class LocalStorage:
    def __init__(self, base: str):
        self.base = Path(base).resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.base / key).resolve()
        if self.base not in p.parents:
            raise ValueError("invalid storage key")
        return p

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()


class GCSStorage:
    def __init__(self, bucket: str):
        from google.cloud import storage  # optional dependency: pip install .[gcs]

        self.bucket = storage.Client().bucket(bucket)

    def put(self, key: str, data: bytes) -> None:
        self.bucket.blob(key).upload_from_string(data, content_type="application/pdf")

    def get(self, key: str) -> bytes:
        return self.bucket.blob(key).download_as_bytes()


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = GCSStorage(s.gcs_bucket) if s.storage_backend == "gcs" else LocalStorage(s.storage_dir)
    return _storage
