"""Phase 5: the theory assistant (Claude).

Claude explains results and helps turn patterns into testable ideas. It does not
detect or vet planets (that's BLS and the random forest). It can query the local
copy of the Exoplanet Archive through the tools in planet_queries.py, so claims
about the planet population are checked against real numbers.

Needs ANTHROPIC_API_KEY, set in the environment or in backend/.env (git-ignored).
"""
import json
import os
from pathlib import Path

import anthropic

from .planet_queries import HANDLERS, TOOLS

MODEL = "claude-opus-5-5"
MAX_TOOL_ROUNDS = 8
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

SYSTEM_PROMPT = """You are the research assistant inside Star Planet Finder, a tool where students and amateur \
astronomers search NASA TESS and Kepler light curves for transiting exoplanets, vet them, and compare them with the \
~6,400 confirmed planets.

How the app works, so you can explain it:
- Find: Box Least Squares searches a light curve for a dip that repeats on a fixed period. Depth gives the planet's \
size relative to its star, duration and period give its orbit. Only planets whose orbits are edge-on to us can be found.
- Vet: a random forest trained on Kepler's confirmed planets and false positives gives a planet probability. Common \
impostors are eclipsing binaries (often V-shaped dips, odd/even depth differences, sizes too big for a planet), \
blended background binaries, and instrument glitches.
- Compare: candidates are placed among confirmed planets: size vs. orbit (with the radius valley at 1.5 to 2 × Earth), \
mass vs. size, and the conservative habitable zone (Kopparapu et al. 2014).

Your job is to explain results clearly and help the user turn patterns into ideas they can test. People using this \
range from high school students to experienced amateurs, so match their level and define jargon when you first use it.

Use the tools whenever a claim depends on the planet population (counts, medians, how two groups differ, size \
distributions, JWST targets) rather than answering from memory, and say what numbers you got. When you suggest a \
hypothesis, make it testable: state what it predicts, how this app's data or tools could check it, and what result \
would count against it. Point out selection effects when they matter. Transits favor big planets, short orbits, and \
small, quiet stars, and the archive mixes many surveys, so a pattern in the catalog isn't automatically a pattern in \
nature.

Be honest about uncertainty. A candidate from this app is not a confirmed planet, the vetting score is a screening \
estimate, and derived values like temperature assume things (zero albedo, a central transit) that may not hold. Keep \
answers focused. A few short paragraphs is usually right unless the user asks for depth."""


def _load_env_file() -> None:
    """Read KEY=VALUE lines from backend/.env without overriding real environment variables."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()


def configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _system(context: dict | None) -> list[dict]:
    # The instructions never change, so they're cached. The notebook's candidate goes after the breakpoint.
    blocks = [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
    if context:
        blocks.append({
            "type": "text",
            "text": "This notebook is about the following candidate from the user's search (JSON). Refer to it when relevant.\n"
                    + json.dumps(context, indent=1),
        })
    return blocks


def _run_tool(name: str, args) -> tuple[str, bool]:
    handler = HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool: {name}", True
    if not isinstance(args, dict):
        return "Tool input must be an object.", True
    try:
        return json.dumps(handler(args)), False
    except Exception as e:  # a bad filter shouldn't end the conversation; let Claude see and adjust
        return f"Tool failed: {e}", True


def run_turn(history: list, user_text: str, context: dict | None, client=None):
    """Answer one user message, yielding events as they happen.

    Events: {"type": "text", "text"}, {"type": "tool", "name", "input"}, {"type": "error", "message"},
    and finally {"type": "done", "messages": [...]}, the new messages to append to the notebook.
    Nothing is yielded as "done" unless the whole turn succeeded, so a failed turn is never saved.
    """
    client = client or anthropic.Anthropic()
    new = [{"role": "user", "content": user_text}]

    for _ in range(MAX_TOOL_ROUNDS):
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=64000,
            system=_system(context),
            tools=TOOLS,
            messages=history + new,
            output_config={"effort": "medium"},
            # If a safety classifier declines, retry server-side on Anthropic's recommended model
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            for event in stream:
                if event.type == "text":
                    yield {"type": "text", "text": event.text}
            response = stream.get_final_message()

        if response.stop_reason == "refusal":
            yield {"type": "error", "message": "Claude declined to answer that. Try asking it a different way."}
            return
        if response.stop_reason == "max_tokens":
            yield {"type": "error", "message": "The answer ran too long and was cut off. Try a narrower question."}
            return

        # Keep every block exactly as returned (thinking included) so the next request can send it back unchanged
        new.append({"role": "assistant", "content": response.to_dict()["content"]})

        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            yield {"type": "done", "messages": new}
            return

        results = []
        for block in tool_uses:
            yield {"type": "tool", "name": block.name, "input": block.input}
            output, is_error = _run_tool(block.name, block.input)
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": output, "is_error": is_error})
        new.append({"role": "user", "content": results})  # all results in one message

    yield {"type": "error", "message": "That needed too many data lookups. Try breaking the question into smaller parts."}


def friendly_error(e: Exception) -> str:
    if isinstance(e, anthropic.AuthenticationError):
        return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in backend/.env."
    if isinstance(e, anthropic.PermissionDeniedError):
        return "This API key doesn't have access to the model. Check the key's workspace settings."
    if isinstance(e, anthropic.RateLimitError):
        return "Too many requests to Claude right now. Wait a minute and try again."
    if isinstance(e, anthropic.APIConnectionError):
        return "Couldn't reach Anthropic's API. Check your internet connection."
    if isinstance(e, anthropic.APIStatusError):
        return f"Claude's API returned an error ({e.status_code}). Try again shortly."
    return f"Something went wrong: {e}"
