// src/index.js
import { openai, supabase } from "./config.js";
import MOVIES from "./content.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const CHAT_MODEL = "gpt-4o-mini";

// UI refs
const els = {
  q1: document.getElementById("q1"),
  q2: document.getElementById("q2"),
  q3: document.getElementById("q3"),
  go: document.getElementById("go-btn"),
  again: document.getElementById("again-btn"),
  next: document.getElementById("next-btn"),
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  slot: document.getElementById("movie-slot"),
  views: {
    q: document.getElementById("questions-view"),
    o: document.getElementById("output-view"),
  },
};

// App state
const state = {
  userText: "",
  matches: [],
  idx: 0,
};

// ---------- View helpers ----------
function switchView(toOutput) {
  els.views.q.classList.toggle("show", !toOutput);
  els.views.o.classList.toggle("show", toOutput);
  els.next.disabled = !toOutput || state.matches.length === 0;
}

function setLoading(v) {
  els.loading.classList.toggle("show", v);
  els.go.disabled = v;
  els.next.disabled = v || state.matches.length === 0;
}

function setError(msg) {
  els.error.textContent = msg || "";
}

// ---------- Utils ----------
function asFloatArray(arr) {
  return Array.isArray(arr) ? arr.map(Number) : [];
}

// ---------- OpenAI helpers ----------
async function embed(text) {
  const e = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return asFloatArray(e.data?.[0]?.embedding ?? []);
}

async function explain(userText, movie) {
  const year = getYear(movie);
  const chat = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: "You are a short, friendly movie recommender." },
      {
        role: "user",
        content: `User: ${userText}\nMovie: ${movie.title}${year ? ` (${year})` : ""}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 60,
  });
  return chat.choices?.[0]?.message?.content ?? "";
}

// ---------- Supabase helpers ----------
async function matchMovies(embedding) {
  const { data, error } = await supabase.rpc("match_movies", {
    query_embedding: embedding,
    match_count: 5,
  });
  if (error) {
    console.error("RPC match_movies error:", error);
    return [];
  }
  return data || [];
}

// OPTIONAL: one-time seeding/backfill helpers for dev use
// Run from the browser console when *you* need it:
//   await window.seedMoviesOnce()
//   await window.backfillEmbeddings()
async function seedMoviesOnce() {
  // Only seed if the table is empty
  const { count, error: cntErr } = await supabase
    .from("movies")
    .select("*", { count: "exact", head: true });
  if (cntErr) throw cntErr;
  if ((count ?? 0) > 0) {
    console.log("Movies already present — skipping seed ✅");
    return;
  }
  console.log("Seeding movies...");
  for (const m of MOVIES) {
    const emb = await embed(`${m.title} (${m.releaseYear}): ${m.content}`);
    const { error } = await supabase.from("movies").insert({
      title: m.title,
      release_year: m.releaseYear, // your column is text; that’s fine
      description: m.content,
      embedding: emb,
    });
    if (error) console.error("Insert error:", error);
  }
  console.log("Seeding complete!");
}

async function backfillEmbeddings() {
  console.log("Backfilling NULL embeddings…");
  const { data, error } = await supabase
    .from("movies")
    .select("id, title, release_year, description, embedding")
    .is("embedding", null);
  if (error) throw error;
  for (const r of data || []) {
    const e = await embed(`${r.title} (${r.release_year ?? ""}): ${r.description ?? ""}`);
    const { error: upErr } = await supabase
      .from("movies")
      .update({ embedding: e })
      .eq("id", r.id);
    if (upErr) console.error("Backfill update failed:", r.id, upErr);
  }
  console.log("Backfill complete.");
}
// expose dev helpers (safe to leave; they don’t run unless you call them)
window.seedMoviesOnce = seedMoviesOnce;
window.backfillEmbeddings = backfillEmbeddings;

// ---------- Renderers ----------
function getYear(obj) {
  return obj?.release_year ?? obj?.releaseYear ?? "";
}

function renderMovie(m) {
  const year = getYear(m);
  els.slot.innerHTML = `
    <h2 class="result-title">
      ${m.title} ${year ? `<span class="result-sub">(${year})</span>` : ""}
    </h2>
    <p class="result-desc">${m.description ?? ""}</p>
    <div class="result-ai" id="ai-explanation">Thinking...</div>
  `;
}

async function explainAndFill(userText, m) {
  try {
    const expl = await explain(userText, m);
    const target = document.getElementById("ai-explanation");
    if (target) target.textContent = expl || " ";
  } catch (e) {
    console.error(e);
    const target = document.getElementById("ai-explanation");
    if (target) target.textContent = "";
  }
}

// ---------- Main submit ----------
async function onSubmit() {
  const a1 = (els.q1.value || "").trim();
  const a2 = (els.q2.value || "").trim();
  const a3 = (els.q3.value || "").trim();

  if (!a1 || !a2 || !a3) {
    setError("Please answer all questions.");
    return;
  }

  setLoading(true);
  setError("");

  try {
    // IMPORTANT: we no longer seed here.
    // If you need to seed, call in console: await window.seedMoviesOnce()
    // If embeddings are missing: await window.backfillEmbeddings()

    const userText = `Favorite: ${a1}. Mood: ${a2}. Tone: ${a3}.`;
    const emb = await embed(userText);
    if (!emb.length) throw new Error("Could not create an embedding for your answers.");

    let matches = await matchMovies(emb);

    // Soft fallback so users never hit a dead end
    if (!matches.length) {
      const { data: fallback, error } = await supabase
        .from("movies")
        .select("*")
        .limit(5);
      if (error) console.error(error);
      if ((fallback || []).length) {
        setError("No perfect matches — showing similar picks:");
        matches = fallback;
      } else {
        throw new Error("No matches found.");
      }
    }

    state.userText = userText;
    state.matches = matches;
    state.idx = 0;

    const movie = state.matches[state.idx];
    renderMovie(movie);
    await explainAndFill(userText, movie);
    switchView(true);
  } catch (e) {
    console.error(e);
    setError(e?.message || String(e));
  } finally {
    setLoading(false);
  }
}

// ---------- Events ----------
els.go.onclick = onSubmit;
els.again.onclick = () => {
  switchView(false);
  setError("");
};
els.next.onclick = async () => {
  if (!state.matches.length) return;
  state.idx = (state.idx + 1) % state.matches.length;
  const m = state.matches[state.idx];
  renderMovie(m);
  await explainAndFill(state.userText, m);
};
switchView(false);
