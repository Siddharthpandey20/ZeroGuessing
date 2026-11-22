import os
import tempfile

# must be set before app modules are imported
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://zeroguess:zeroguess@localhost:5433/zeroguess_test")
os.environ["API_KEY"] = "test-key"
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="zg-files-")
os.environ.setdefault("GEMINI_API_KEY", "")
