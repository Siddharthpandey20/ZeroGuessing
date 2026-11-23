"""File storage: local disk for dev (or a mounted volume), S3/S3-compatible or GCS for hosted deploys."""

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


class S3Storage:
    """AWS S3 or any S3-compatible store (Cloudflare R2, Railway buckets, MinIO)."""

    def __init__(self, bucket: str, region: str = "", endpoint_url: str = "", prefix: str = ""):
        import boto3  # optional dependency: uv sync --extra s3

        self.bucket = bucket
        self.prefix = prefix.strip("/") + "/" if prefix.strip("/") else ""
        self.client = boto3.client("s3", region_name=region or None, endpoint_url=endpoint_url or None)

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self.prefix + key, Body=data, ContentType="application/pdf")

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=self.prefix + key)["Body"].read()


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        if s.storage_backend == "s3":
            if not s.s3_bucket:
                raise RuntimeError("STORAGE_BACKEND=s3 needs S3_BUCKET")
            _storage = S3Storage(s.s3_bucket, s.s3_region, s.s3_endpoint_url, s.s3_prefix)
        elif s.storage_backend == "gcs":
            _storage = GCSStorage(s.gcs_bucket)
        else:
            _storage = LocalStorage(s.storage_dir)
    return _storage
