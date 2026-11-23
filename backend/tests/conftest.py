import os
import tempfile

# must be set before app modules are imported
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://zeroguess:zeroguess@localhost:5433/zeroguess_test")
# the tests drop every table: never let them point at the real database (a DATABASE_URL exported in the shell
# would otherwise win over the default above and wipe users, chats and documents)
if not os.environ["DATABASE_URL"].rsplit("/", 1)[-1].split("?")[0].endswith("_test"):
    raise RuntimeError(f"refusing to run tests against a non-test database: {os.environ['DATABASE_URL']}")
os.environ["API_KEY"] = "test-key"
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="zg-files-")
os.environ.setdefault("GEMINI_API_KEY", "")
