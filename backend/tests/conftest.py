"""Shared pytest fixtures.

The API tests run against a real Postgres database (the app uses native
Postgres enums, and production runs on Postgres), migrated with Alembic and
reseeded with seed.py before every test that touches the DB.

Because seed.py wipes the tables it owns, the suite refuses to run unless
TEST_DATABASE_URL is set explicitly; it never falls back to DATABASE_URL, so
a developer's .env pointing at a shared Neon database can't be reseeded by
accident.
"""
import contextlib
import io
import os
from collections.abc import Iterator
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    raise pytest.UsageError(
        "Set TEST_DATABASE_URL to a disposable Postgres database before running the tests, e.g.\n"
        "  TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rental_test pytest"
    )

# Must happen before anything imports app.config, which reads settings once.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SKIP_DOCUMENT_OCR"] = "true"
os.environ.pop("ANTHROPIC_API_KEY", None)


@pytest.fixture(scope="session")
def migrated_db() -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(config, "head")


@pytest.fixture
def seeded_db(migrated_db: None) -> None:
    """Fresh, known seed data for every test that uses it."""
    import seed

    with contextlib.redirect_stdout(io.StringIO()):
        seed.run()


@pytest.fixture
def client(seeded_db: None) -> Iterator["TestClient"]:  # noqa: F821
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
