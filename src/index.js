import { openai, supabase } from "./config.js";
import MOVIES from "./content.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const CHAT_MODEL = "gpt-4o-mini";

// UI references
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

// Utility: Switch between question and output views
function switchView(toOutput) {
  els.views.q.classList.toggle("show", !toOutput);
  els.views.o.classList.toggle("show", toOutput);
}

// Utility: show/hide loading spinner
function setLoading(v) {
  els.loading.classList.toggle("show", v);
  els.go.disabled = v;
}

// 🔹 Get text embedding from OpenAI
async function embed(text) {
  const e = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return e.data[0].embedding;
}

// 🔹 Seed Supabase with movies if not already there
async function seedMovies() {
  for (const m of MOVIES) {
    const { data: ex } = await supabase
      .from("movies")
      .select("id")
      .eq("title", m.title)
      .maybeSingle();
    if (ex) continue;
    const emb = await embed(`${m.title} (${m.releaseYear}): ${m.content}`);
    await supabase.from("movies").insert({
      title: m.title,
      release_year: m.releaseYear,
      description: m.content,
      embedding: emb,
    });
  }
}

// 🔹 Ask Supabase for similar movies (match_movies function)
async function matchMovies(embedding) {
  const { data, error } = await supabase.rpc("match_movies", {
    query_embedding: embedding,
    match_count: 5,
  });
  if (error) throw error;
  return data || [];
}

// 🔹 Ask OpenAI to explain why the movie matches
async function explain(userText, movie) {
  const chat = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: "You are a short, friendly movie recommender." },
      {
        role: "user",
        content: `User: ${userText}\nMovie: ${movie.title} (${movie.release_year})`,
      },
    ],
    temperature: 0.7,
    max_tokens: 60,
  });
  return chat.choices[0].message.content;
}

// 🔹 Render a movie card to the page
function renderMovie(m) {
  els.slot.innerHTML = `
    <h2 class="result-title">${m.title} <span class="result-sub">(${m.release_year})</span></h2>
    <p class="result-desc">${m.description}</p>
    <div class="result-ai" id="ai-explanation">Thinking...</div>
  `;
}

// 🔹 Show movie + AI explanation
async function explainAndFill(userText, m) {
  const expl = await explain(userText, m);
  document.getElementById("ai-explanation").textContent = expl;
}

// 🔹 Main submit function
async function onSubmit() {
  const a1 = els.q1.value,
    a2 = els.q2.value,
    a3 = els.q3.value;

  if (!a1 || !a2 || !a3) {
    els.error.textContent = "Please answer all questions.";
    return;
  }

  setLoading(true);
  els.error.textContent = "";

  try {
    await seedMovies();
    const userText = `Favorite: ${a1}. Mood: ${a2}. Tone: ${a3}.`;
    const emb = await embed(userText);
    const matches = await matchMovies(emb);

    state.userText = userText;
    state.matches = matches;
    state.idx = 0;

    if (!matches.length) throw new Error("No matches found.");

    const movie = matches[state.idx];
    renderMovie(movie);
    await explainAndFill(userText, movie);
    switchView(true);
  } catch (e) {
    els.error.textContent = e.message;
  }

  setLoading(false);
}

// 🔹 Button handlers
els.go.onclick = onSubmit;
els.again.onclick = () => switchView(false);
els.next.onclick = async () => {
  if (!state.matches.length) return;
  state.idx = (state.idx + 1) % state.matches.length;
  const m = state.matches[state.idx];
  renderMovie(m);
  await explainAndFill(state.userText, m);
};
