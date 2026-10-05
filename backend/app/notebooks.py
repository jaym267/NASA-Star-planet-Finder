"""Phase 5: saved theory notebooks, one set per user.

Each notebook holds a hypothesis, the user's own notes, an optional snapshot of a
candidate it's about, and the full conversation with the assistant. The conversation
is stored exactly as the API returned it (including thinking blocks), so it can be
sent back unchanged on the next turn.

Users are identified by an ID the browser generates and sends in the X-User-Id
header. That's fine for a local tool, but it is NOT authentication. Real accounts
are needed before this is deployed for other people.
"""
import json
import re
from contextlib import contextmanager
import sqlite3
import time
import uuid
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "user" / "notebooks.sqlite"
USER_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")


@contextmanager
def _db():
    """A connection that commits on success and is always closed (sqlite3's own `with` doesn't close)."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    try:
        _ensure_schema(con)
        yield con
        con.commit()
    finally:
        con.close()


def _ensure_schema(con: sqlite3.Connection) -> None:
    con.row_factory = sqlite3.Row
    con.execute(
        """CREATE TABLE IF NOT EXISTS notebooks (
            id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            title TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            context TEXT,            -- JSON snapshot of a candidate, or NULL
            messages TEXT NOT NULL DEFAULT '[]',  -- JSON, exact API message history
            created REAL NOT NULL,
            updated REAL NOT NULL
        )"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS notebooks_owner ON notebooks(owner, updated)")


class NotFound(Exception):
    pass


def valid_user(user_id: str | None) -> bool:
    return bool(user_id and USER_ID.match(user_id))


def list_notebooks(owner: str) -> list[dict]:
    with _db() as con:
        rows = con.execute(
            "SELECT id, title, context, created, updated, messages FROM notebooks WHERE owner = ? ORDER BY updated DESC",
            (owner,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "title": r["title"],
            "about": (json.loads(r["context"]) or {}).get("label") if r["context"] else None,
            "turns": sum(1 for m in json.loads(r["messages"]) if m["role"] == "user" and isinstance(m["content"], str)),
            "updated": r["updated"],
        }
        for r in rows
    ]


def create_notebook(owner: str, title: str, context: dict | None) -> dict:
    now = time.time()
    nb_id = uuid.uuid4().hex
    with _db() as con:
        con.execute(
            "INSERT INTO notebooks (id, owner, title, context, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
            (nb_id, owner, title, json.dumps(context) if context else None, now, now),
        )
    return get_notebook(owner, nb_id)


def _row(con, owner: str, nb_id: str) -> sqlite3.Row:
    row = con.execute("SELECT * FROM notebooks WHERE id = ? AND owner = ?", (nb_id, owner)).fetchone()
    if row is None:
        raise NotFound(nb_id)
    return row


def get_notebook(owner: str, nb_id: str) -> dict:
    with _db() as con:
        r = _row(con, owner, nb_id)
    messages = json.loads(r["messages"])
    return {
        "id": r["id"],
        "title": r["title"],
        "notes": r["notes"],
        "context": json.loads(r["context"]) if r["context"] else None,
        "conversation": display_messages(messages),
        "created": r["created"],
        "updated": r["updated"],
    }


def get_history(owner: str, nb_id: str) -> tuple[list, dict | None]:
    with _db() as con:
        r = _row(con, owner, nb_id)
    return json.loads(r["messages"]), json.loads(r["context"]) if r["context"] else None


def update_notebook(owner: str, nb_id: str, title: str | None = None, notes: str | None = None) -> dict:
    with _db() as con:
        _row(con, owner, nb_id)
        if title is not None:
            con.execute("UPDATE notebooks SET title = ?, updated = ? WHERE id = ?", (title, time.time(), nb_id))
        if notes is not None:
            con.execute("UPDATE notebooks SET notes = ?, updated = ? WHERE id = ?", (notes, time.time(), nb_id))
    return get_notebook(owner, nb_id)


def append_messages(owner: str, nb_id: str, new_messages: list) -> None:
    """Append-only: earlier turns are never edited, so thinking blocks stay valid."""
    with _db() as con:
        r = _row(con, owner, nb_id)
        messages = json.loads(r["messages"]) + new_messages
        con.execute("UPDATE notebooks SET messages = ?, updated = ? WHERE id = ?", (json.dumps(messages), time.time(), nb_id))


def delete_notebook(owner: str, nb_id: str) -> None:
    with _db() as con:
        _row(con, owner, nb_id)
        con.execute("DELETE FROM notebooks WHERE id = ?", (nb_id,))


def display_messages(messages: list) -> list[dict]:
    """Collapse the raw API history into what a person reads: their questions, Claude's text, and which data it checked."""
    out = []
    for m in messages:
        content = m["content"]
        if m["role"] == "user":
            if isinstance(content, str):
                out.append({"role": "user", "text": content})
            continue  # tool results are shown via the assistant's tool-call notes
        texts, checks = [], []
        for block in content:
            if block.get("type") == "text" and block.get("text"):
                texts.append(block["text"])
            elif block.get("type") == "tool_use":
                checks.append(block["name"])
        if out and out[-1]["role"] == "assistant":
            out[-1]["text"] = "\n\n".join(t for t in [out[-1]["text"], *texts] if t)
            out[-1]["checked"] += checks
        else:
            out.append({"role": "assistant", "text": "\n\n".join(texts), "checked": checks})
    return out
