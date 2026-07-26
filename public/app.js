const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 700,
  reconnectionDelayMax: 4000
});

const colours = {
  1: "#ef5350",
  2: "#ec7c31",
  3: "#e8aa2f",
  4: "#97b84f",
  5: "#41b883",
  6: "#2bb3b1",
  7: "#408fd1",
  8: "#7467d8",
  9: "#b153c6"
};

let state = null;
let soundEnabled = true;
let lastMessage = "";
let hasCelebrated = false;

const homeView = document.getElementById("homeView");
const roomView = document.getElementById("roomView");
const nameInput = document.getElementById("nameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const homeError = document.getElementById("homeError");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const shareBtn = document.getElementById("shareBtn");
const leaveBtn = document.getElementById("leaveBtn");
const soundBtn = document.getElementById("soundBtn");
const phaseText = document.getElementById("phaseText");
const mainStatus = document.getElementById("mainStatus");
const gameMessage = document.getElementById("gameMessage");
const roundBadge = document.getElementById("roundBadge");
const playersGrid = document.getElementById("playersGrid");
const lobbyControls = document.getElementById("lobbyControls");
const lobbyHint = document.getElementById("lobbyHint");
const startGameBtn = document.getElementById("startGameBtn");
const gameArea = document.getElementById("gameArea");
const turnBanner = document.getElementById("turnBanner");
const turnPlayerName = document.getElementById("turnPlayerName");
const activityFeed = document.getElementById("activityFeed");
const handArea = document.getElementById("handArea");
const flipBtn = document.getElementById("flipBtn");
const bankBtn = document.getElementById("bankBtn");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const actionError = document.getElementById("actionError");
const toast = document.getElementById("toast");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function score(player) {
  if (player.busted) return 0;

  const total = player.roundCards.reduce((sum, number) => sum + number, 0);
  return total + (player.completedFlip9 ? 25 : 0);
}

function playerState(player) {
  if (!player.connected) return "Offline";
  if (player.busted) return "Busted";
  if (player.banked) return "Banked";
  return "Playing";
}

function cardMarkup(number) {
  return `
    <div class="playing-card" style="--colour:${colours[number]}">
      <div class="card-corner top">${number}</div>
      <div class="card-number">${number}</div>
      <div class="card-corner bottom">${number}</div>
    </div>
  `;
}

function saveSession(code, token) {
  localStorage.setItem("flip9Session", JSON.stringify({ code, token }));
}

function clearSession() {
  localStorage.removeItem("flip9Session");
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 1700);
}

function playTone(frequency, duration = 0.12, type = "sine") {
  if (!soundEnabled) return;

  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.frequency.value = frequency;
    oscillator.type = type;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  } catch {}
}

function launchConfetti() {
  const palette = ["#f8c85f", "#6dbafc", "#5ee092", "#ff8080", "#b153c6"];

  for (let index = 0; index < 100; index += 1) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = palette[Math.floor(Math.random() * palette.length)];
    piece.style.animationDuration = `${2.4 + Math.random() * 2.5}s`;
    piece.style.animationDelay = `${Math.random() * .7}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 5500);
  }
}

function handleReply(result, target = actionError) {
  if (!result?.ok) {
    target.textContent = result?.error || "Something went wrong.";
    playTone(160, .16, "sawtooth");
    return false;
  }

  return true;
}

function createRoom() {
  homeError.textContent = "";

  socket.emit("createRoom", { name: nameInput.value }, result => {
    if (!handleReply(result, homeError)) return;
    saveSession(result.code, result.token);
  });
}

function joinRoom() {
  homeError.textContent = "";

  socket.emit(
    "joinRoom",
    { name: nameInput.value, code: roomCodeInput.value },
    result => {
      if (!handleReply(result, homeError)) return;
      saveSession(result.code, result.token);
    }
  );
}

function renderActivity() {
  const actions = state?.recentActions || [];

  activityFeed.innerHTML = actions.length
    ? actions.map(action => `
        <div class="activity-item ${escapeHtml(action.type || "info")}">
          <span class="activity-dot"></span>
          <span class="activity-text">${escapeHtml(action.text)}</span>
        </div>
      `).join("")
    : `<div class="muted">The table is quiet… suspiciously quiet.</div>`;
}

function render() {
  if (!state) return;

  homeView.classList.add("hidden");
  roomView.classList.remove("hidden");

  const me = state.players.find(player => player.token === state.viewerToken);
  const current = state.players.find(player => player.token === state.currentPlayerToken);
  const winner = state.players.find(player => player.token === state.winnerToken);
  const isHost = state.hostToken === state.viewerToken;
  const isMyTurn = state.currentPlayerToken === state.viewerToken && state.phase === "playing";

  copyCodeBtn.textContent = state.code;
  phaseText.textContent =
    state.phase === "lobby"
      ? "Waiting room"
      : state.phase === "playing"
      ? "Game in progress"
      : state.phase === "roundOver"
      ? "Round complete"
      : "Game finished";

  gameMessage.textContent = state.message || "";
  roundBadge.textContent =
    state.phase === "lobby"
      ? `${state.players.length}/10 players`
      : `Round ${state.roundNumber} • ${state.deckCount} cards`;

  renderActivity();
  turnPlayerName.textContent = current?.name || "—";

  playersGrid.innerHTML = state.players.map(player => `
    <article class="player-card
      ${player.token === state.currentPlayerToken ? "active" : ""}
      ${player.banked || player.busted ? "done" : ""}
      ${!player.connected ? "offline" : ""}
      ${player.token === state.viewerToken ? "me" : ""}">
      <div class="player-name">
        ${escapeHtml(player.name)}
        ${player.token === state.hostToken ? " 👑" : ""}
      </div>
      <div class="score-row"><span>Total</span><strong>${player.totalScore}</strong></div>
      <div class="score-row"><span>Round</span><strong>${score(player)}</strong></div>
      <div class="score-row"><span>Status</span><strong>${playerState(player)}</strong></div>
    </article>
  `).join("");

  if (state.message && state.message !== lastMessage) {
    if (state.message.includes("flipped")) playTone(510, .08);
    if (state.message.includes("banked")) playTone(660, .12);
    if (isMyTurn) setTimeout(() => playTone(720, .1), 120);
    if (state.message.includes("busted")) playTone(150, .22, "sawtooth");
    lastMessage = state.message;
  }

  if (state.phase === "lobby") {
    lobbyControls.classList.remove("hidden");
    gameArea.classList.add("hidden");
    mainStatus.textContent = isHost ? "Your room is ready" : "Waiting for the host";
    lobbyHint.textContent = isHost
      ? "Share the room code. Start once at least two players have joined."
      : "The host will begin when everyone is ready.";
    startGameBtn.classList.toggle("hidden", !isHost);
    startGameBtn.disabled = state.players.filter(player => player.connected).length < 2;
    return;
  }

  lobbyControls.classList.add("hidden");
  gameArea.classList.remove("hidden");

  if (state.phase === "playing") {
    mainStatus.textContent = isMyTurn
      ? "It’s your turn"
      : `${current?.name || "Another player"} is playing`;

    turnBanner.textContent = isMyTurn
      ? "Flip one card or bank — then play moves on."
      : `Waiting for ${current?.name || "the next player"} to choose.`;

    handArea.innerHTML = current?.roundCards?.length
      ? current.roundCards.map(cardMarkup).join("")
      : `<div class="muted">${isMyTurn ? "Flip a card to begin." : "No cards flipped yet."}</div>`;

    flipBtn.classList.remove("hidden");
    bankBtn.classList.remove("hidden");
    nextRoundBtn.classList.add("hidden");

    flipBtn.disabled = !isMyTurn;
    bankBtn.disabled = !isMyTurn || !me || me.roundCards.length === 0;
  }

  if (state.phase === "roundOver") {
    mainStatus.textContent = "Round complete";
    turnBanner.textContent = isHost
      ? "Start the next round when everyone is ready."
      : "Waiting for the host.";

    handArea.innerHTML = [...state.players]
      .sort((a, b) => score(b) - score(a))
      .map(player => `
        <article class="player-card" style="width:190px;text-align:left;">
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="score-row"><span>Round</span><strong>${score(player)}</strong></div>
          <div class="score-row"><span>Total</span><strong>${player.totalScore}</strong></div>
        </article>
      `).join("");

    flipBtn.classList.add("hidden");
    bankBtn.classList.add("hidden");
    nextRoundBtn.classList.toggle("hidden", !isHost);
  }

  if (state.phase === "finished") {
    mainStatus.textContent = `${winner?.name || "Someone"} wins!`;
    turnBanner.textContent = "Game over";
    handArea.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:5rem;">🏆</div>
        <div style="font-size:2rem;font-weight:1000;">${escapeHtml(winner?.name || "")}</div>
        <div class="muted">${winner?.totalScore || 0} points</div>
      </div>
    `;

    flipBtn.classList.add("hidden");
    bankBtn.classList.add("hidden");
    nextRoundBtn.classList.add("hidden");

    if (!hasCelebrated) {
      hasCelebrated = true;
      launchConfetti();
      playTone(784, .18);
      setTimeout(() => playTone(988, .22), 160);
    }
  }
}

socket.on("roomState", roomState => {
  state = roomState;
  actionError.textContent = "";
  render();
});

socket.on("connect", () => {
  actionError.textContent = "";

  const saved = JSON.parse(localStorage.getItem("flip9Session") || "null");

  if (saved?.code && saved?.token) {
    socket.emit("reconnectPlayer", saved, result => {
      if (!result?.ok) clearSession();
    });
  }
});

socket.on("disconnect", () => {
  actionError.textContent = "Connection lost. Reconnecting…";
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
});

createBtn.addEventListener("click", createRoom);
joinBtn.addEventListener("click", joinRoom);

roomCodeInput.addEventListener("keydown", event => {
  if (event.key === "Enter") joinRoom();
});

nameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") createRoom();
});

startGameBtn.addEventListener("click", () => {
  socket.emit("startGame", result => handleReply(result));
});

flipBtn.addEventListener("click", () => {
  socket.emit("flipCard", result => handleReply(result));
});

bankBtn.addEventListener("click", () => {
  socket.emit("bankScore", result => handleReply(result));
});

nextRoundBtn.addEventListener("click", () => {
  socket.emit("nextRound", result => handleReply(result));
});

copyCodeBtn.addEventListener("click", async () => {
  if (!state) return;
  await navigator.clipboard.writeText(state.code);
  showToast("Room code copied");
});

shareBtn.addEventListener("click", async () => {
  if (!state) return;

  const inviteUrl = `${location.origin}/?room=${state.code}`;
  await navigator.clipboard.writeText(inviteUrl);
  showToast("Invite link copied");
});

soundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
  showToast(soundEnabled ? "Sound on" : "Sound off");
});

leaveBtn.addEventListener("click", () => {
  socket.emit("leaveRoom");
  clearSession();
  state = null;
  hasCelebrated = false;
  roomView.classList.add("hidden");
  homeView.classList.remove("hidden");
  history.replaceState({}, "", location.pathname);
});

const roomFromUrl = new URLSearchParams(location.search).get("room");
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.toUpperCase().slice(0, 5);
}
