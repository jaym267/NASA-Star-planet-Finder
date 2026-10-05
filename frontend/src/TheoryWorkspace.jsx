import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import {
  createNotebook, deleteNotebook, fetchAssistantStatus, getNotebook, listNotebooks, streamChat, updateNotebook,
} from "./api";

const STARTERS = [
  "Is there really a radius valley in this data? How could I test it?",
  "Do planets around red dwarfs differ from planets around Sun-like stars? What could explain it?",
  "Which known planets would be best for JWST to study their atmospheres?",
  "What would make a transit signal more likely to be an eclipsing binary than a planet?",
];
const CANDIDATE_STARTERS = [
  "Explain my candidate in plain language. Is it likely real?",
  "How does my candidate compare with similar known planets?",
];

const TOOL_LABELS = {
  query_planets: "Checked the planet archive",
  size_distribution: "Counted planets by size",
  jwst_targets: "Ranked JWST targets",
};

/** A snapshot of a search candidate to attach to a notebook, so Claude knows what it's about. */
function candidateContext(search, i) {
  const s = search.signals[i];
  return {
    label: `${search.target} candidate ${i + 1}`,
    target: search.target,
    mission: search.mission,
    star: search.star,
    period_days: s.period_days,
    depth_ppm: s.depth_ppm,
    duration_hours: s.duration_hours,
    planet_radius_earth: s.planet_radius_earth,
    snr: s.snr,
    transits_observed: s.transits_observed,
    odd_even_sigma: s.odd_even_sigma,
    matches_known_planet: s.match?.name ?? null,
    vetting: s.vetting && { planet_probability: s.vetting.planet_probability, verdict: s.vetting.verdict, notes: s.vetting.notes },
    derived: s.derived,
    searched: search.observations_used,
  };
}

function SetupNotice() {
  return (
    <div className="mt-6 rounded-md border border-ink-light px-4 py-3 text-sm">
      <p className="font-medium">The assistant needs an Anthropic API key.</p>
      <p className="mt-1 text-dim">
        Create a file named <code>backend/.env</code> containing <code>ANTHROPIC_API_KEY=your-key</code>, then restart the
        backend. The file is git-ignored, so the key won't be committed. You can still write notes without it.
      </p>
    </div>
  );
}

function NotebookList({ items, activeId, onOpen, onNew, search }) {
  const [title, setTitle] = useState("");
  const [about, setAbout] = useState("");
  const candidates = search?.signals ?? [];

  return (
    <aside className="space-y-4">
      <form
        className="space-y-2 rounded-md border border-ink-light p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          onNew(title.trim(), about === "" ? null : candidateContext(search, Number(about)));
          setTitle("");
        }}
      >
        <label className="block text-sm font-medium" htmlFor="nb-title">New notebook</label>
        <input id="nb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Red dwarf planets are smaller"
          className="w-full rounded-md border border-ink-light bg-ink-light px-3 py-2 text-sm outline-none focus:border-star" />
        {candidates.length > 0 && (
          <select value={about} onChange={(e) => setAbout(e.target.value)} aria-label="Attach a candidate"
            className="w-full rounded-md border border-ink-light bg-ink-light px-3 py-2 text-sm">
            <option value="">Not about a specific candidate</option>
            {candidates.map((s, i) => (
              <option key={i} value={i}>About {search.target} candidate {i + 1} ({s.period_days.toFixed(2)} d)</option>
            ))}
          </select>
        )}
        <button type="submit" className="w-full rounded-md bg-star px-3 py-2 text-sm font-medium text-ink">Create</button>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-dim">No notebooks yet. Each one holds a question you're investigating, your notes, and your conversation with the assistant.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((nb) => (
            <li key={nb.id}>
              <button onClick={() => onOpen(nb.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${nb.id === activeId ? "bg-ink-light" : "hover:bg-ink-light/60"}`}>
                <span className="block font-medium">{nb.title}</span>
                <span className="block text-xs text-dim">
                  {nb.about ? `${nb.about} · ` : ""}{nb.turns} {nb.turns === 1 ? "question" : "questions"} · {new Date(nb.updated * 1000).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Notebook({ id, configured, onChanged, onDeleted }) {
  const [nb, setNb] = useState(null);
  const [notes, setNotes] = useState("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(null); // the reply streaming in right now
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    setNb(null);
    setError("");
    getNotebook(id).then((n) => { setNb(n); setNotes(n.notes); }).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [nb?.conversation.length, pending?.text.length]);

  async function ask(text) {
    if (!text.trim() || pending) return;
    setInput("");
    setError("");
    const question = text.trim();
    setPending({ question, text: "", checked: [] });
    let failed = false;
    try {
      await streamChat(id, question, (ev) => {
        if (ev.type === "text") setPending((p) => ({ ...p, text: p.text + ev.text }));
        if (ev.type === "tool") setPending((p) => ({ ...p, text: p.text ? p.text + "\n\n" : p.text, checked: [...p.checked, ev.name] }));
        if (ev.type === "error") { failed = true; setError(ev.message); }
      });
    } catch (e) {
      failed = true;
      setError(e.message);
    }
    if (failed) setInput(question); // nothing was saved, so give the question back to retry
    const fresh = await getNotebook(id).catch(() => null);
    if (fresh) setNb(fresh);
    setPending(null);
    onChanged();
  }

  // Autosave notes a moment after typing stops, so nothing is lost if the tab closes
  useEffect(() => {
    if (!nb || notes === nb.notes) return;
    const timer = setTimeout(() => {
      updateNotebook(id, { notes })
        .then((saved) => setNb((current) => ({ ...current, notes: saved.notes })))
        .catch((e) => setError(`Couldn't save notes: ${e.message}`));
    }, 800);
    return () => clearTimeout(timer);
  }, [notes, nb, id]);

  if (error && !nb) return <p className="text-danger">{error}</p>;
  if (!nb) return <p className="text-dim">Opening…</p>;

  const starters = nb.context ? [...CANDIDATE_STARTERS, ...STARTERS.slice(0, 2)] : STARTERS;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{nb.title}</h3>
          {nb.context && <p className="text-sm text-dim">About {nb.context.label}</p>}
        </div>
        <button
          onClick={async () => {
            if (window.confirm(`Delete "${nb.title}"? This can't be undone.`)) {
              await deleteNotebook(id);
              onDeleted();
            }
          }}
          className="rounded-md border border-ink-light px-3 py-1 text-sm text-dim hover:border-danger hover:text-danger"
        >
          Delete
        </button>
      </div>

      <div>
        <label htmlFor="nb-notes" className="text-sm font-medium">Your notes</label>
        <textarea id="nb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
          placeholder="Your hypothesis, what you've tried, what would prove you wrong…"
          className="mt-1 w-full rounded-md border border-ink-light bg-ink-light px-3 py-2 text-sm outline-none focus:border-star" />
        <p className="text-xs text-dim">{nb.notes === notes ? "Saved." : "Saving…"}</p>
      </div>

      <div className="space-y-4">
        {nb.conversation.map((m, i) => <Turn key={i} message={m} />)}
        {pending && (
          <>
            <Turn message={{ role: "user", text: pending.question }} />
            <Turn message={{ role: "assistant", text: pending.text, checked: pending.checked }} streaming />
          </>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!configured ? (
        <SetupNotice />
      ) : (
        <>
          {nb.conversation.length === 0 && !pending && (
            <div className="flex flex-wrap gap-2">
              {starters.map((s) => (
                <button key={s} onClick={() => ask(s)}
                  className="rounded-md border border-ink-light px-3 py-1.5 text-left text-sm text-dim hover:border-dim hover:text-paper">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} aria-label="Ask the assistant"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
              placeholder="Ask about your candidate, a pattern, or an idea to test…"
              className="min-w-0 flex-1 rounded-md border border-ink-light bg-ink-light px-3 py-2 text-sm outline-none focus:border-star" />
            <button type="submit" disabled={!!pending || !input.trim()}
              className="self-end rounded-md bg-star px-4 py-2 text-sm font-medium text-ink disabled:opacity-50">
              {pending ? "…" : "Ask"}
            </button>
          </form>
          <p className="text-xs text-dim">Answers come from Claude and can be wrong. Check its numbers on the Compare tab.</p>
        </>
      )}
    </div>
  );
}

function Turn({ message, streaming }) {
  if (message.role === "user") {
    return <div className="ml-auto max-w-[85%] rounded-lg bg-ink-light px-4 py-2 text-sm">{message.text}</div>;
  }
  const checked = [...new Set(message.checked ?? [])];
  return (
    <div className="text-sm">
      {checked.length > 0 && (
        <p className="mb-1 text-xs text-dim">{checked.map((c) => TOOL_LABELS[c] ?? c).join(" · ")}</p>
      )}
      <div className="prose-chat space-y-2 leading-relaxed">
        {message.text ? <Markdown>{message.text}</Markdown> : streaming && <p className="text-dim">Thinking…</p>}
      </div>
    </div>
  );
}

export default function TheoryWorkspace({ search }) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");

  const refresh = () =>
    listNotebooks()
      .then((list) => { setItems(list); setError(""); })
      .catch((e) => setError(`Couldn't load notebooks: ${e.message}`));

  useEffect(() => {
    refresh();
    fetchAssistantStatus().then((s) => setConfigured(s.configured)).catch(() => setConfigured(false));
  }, []);

  return (
    <div className="mt-8">
      {error && <p className="mb-4 text-danger">{error}</p>}
      <div className="grid gap-8 md:grid-cols-[260px_1fr]">
        <NotebookList
          items={items}
          activeId={activeId}
          search={search}
          onOpen={setActiveId}
          onNew={async (title, context) => {
            try {
              const nb = await createNotebook(title, context);
              await refresh();
              setActiveId(nb.id);
            } catch (e) {
              setError(e.message);
            }
          }}
        />
        {activeId ? (
          <Notebook key={activeId} id={activeId} configured={configured} onChanged={refresh}
            onDeleted={() => { setActiveId(null); refresh(); }} />
        ) : (
          <div className="text-sm text-dim">
            <p>Pick a notebook or start a new one.</p>
            {!configured && <SetupNotice />}
          </div>
        )}
      </div>
    </div>
  );
}
