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
let previousMessage = "";
let seenReactionTimes = new Set();
let actionPending = false;
let previousPhase = null;
let previousRoundNumber = null;

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
const deckStack = document.getElementById("deckStack");
const centreCard = document.getElementById("centreCard");
const reactionStage = document.getElementById("reactionStage");
const leaderboard = document.getElementById("leaderboard");
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

function setActionPending(pending) {
  actionPending = pending;

  flipBtn.disabled = pending || flipBtn.disabled;
  bankBtn.disabled = pending || bankBtn.disabled;
  nextRoundBtn.disabled = pending;
  startGameBtn.disabled = pending || startGameBtn.disabled;
}

function handleReply(result, target = actionError) {
  if (!result?.ok) {
    target.textContent = result?.error || "Something went wrong.";
    playTone(160, .16, "sawtooth");
    return false;
  }

  target.textContent = "";
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

function renderLeaderboard() {
  const sorted = [...(state?.players || [])].sort((a, b) => b.totalScore - a.totalScore);

  leaderboard.innerHTML = sorted.map((player, index) => `
    <div class="leader-row">
      <div class="leader-rank">${index + 1}</div>
      <div class="leader-name" style="color:${player.colour || "#fff"}">${escapeHtml(player.name)}</div>
      <div class="leader-score">${player.totalScore}</div>
    </div>
  `).join("");
}

function showReaction(reaction) {
  if (seenReactionTimes.has(reaction.at)) return;
  seenReactionTimes.add(reaction.at);

  const bubble = document.createElement("div");
  bubble.className = "floating-reaction";
  bubble.style.left = `${12 + Math.random() * 76}%`;
  bubble.innerHTML = `${reaction.emoji}<small>${escapeHtml(reaction.playerName)}</small>`;
  reactionStage.appendChild(bubble);
  setTimeout(() => bubble.remove(), 2100);
}

function dramaticFlash(type) {
  const flash = document.createElement("div");
  flash.className = `screen-flash ${type}`;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 600);
}

function showBust() {
  dramaticFlash("bad");
  const bust = document.createElement("div");
  bust.className = "big-bust";
  bust.textContent = "BUST!";
  document.body.appendChild(bust);
  if (navigator.vibrate) navigator.vibrate([120, 60, 180]);
  setTimeout(() => bust.remove(), 950);
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
  renderLeaderboard();
  turnPlayerName.textContent = current?.name || "—";
  deckStack.classList.toggle("active", isMyTurn);

  for (const reaction of state.reactions || []) {
    showReaction(reaction);
  }

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
      <div class="risk-meter">
        <div class="risk-label"><span>RISK</span><span>${Math.min(100, player.roundCards.length * 12)}%</span></div>
        <div class="risk-track">
          <div class="risk-fill" style="width:${Math.min(100, player.roundCards.length * 12)}%"></div>
        </div>
      </div>
    </article>
  `).join("");

  if (state.message && state.message !== lastMessage) {
    if (state.message.includes("flipped") || state.message.includes("survives") || state.message.includes("risked")) {
      playTone(510, .08);
      dramaticFlash("good");
      const match = state.message.match(/(?:a |with |found a )(\d)/i);
      if (match) {
        centreCard.className = "playing-card centre-card-reveal";
        centreCard.style.setProperty("--colour", colours[match[1]]);
        centreCard.innerHTML = `
          <div class="card-corner top">${match[1]}</div>
          <div class="card-number">${match[1]}</div>
          <div class="card-corner bottom">${match[1]}</div>
        `;
      }
    }
    if (state.message.includes("banked")) playTone(660, .12);
    if (state.message.includes("busted")) {
      playTone(150, .22, "sawtooth");
      showBust();
    }
    if (isMyTurn) setTimeout(() => playTone(720, .1), 120);
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
    startGameBtn.disabled =
      actionPending ||
      state.players.filter(player => player.connected).length < 2;
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

    flipBtn.disabled = actionPending || !isMyTurn;
    bankBtn.disabled = actionPending || !isMyTurn || !me || me.roundCards.length === 0;
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
    nextRoundBtn.disabled = actionPending;
  }

  if (state.phase === "finished") {
    mainStatus.textContent = `${winner?.name || "Someone"} wins!`;
    turnBanner.textContent = "Game over";
    const podiumPlayers = [...state.players].sort((a,b) => b.totalScore - a.totalScore).slice(0,3);
    handArea.innerHTML = `
      <div class="podium">
        ${podiumPlayers.map((player,index) => `
          <div class="podium-place ${index === 0 ? "first" : index === 1 ? "second" : "third"}">
            <div style="font-size:${index === 0 ? "3.2rem" : "2.4rem"}">${index === 0 ? "🏆" : index === 1 ? "🥈" : "🥉"}</div>
            <div style="font-weight:1000;color:${player.colour}">${escapeHtml(player.name)}</div>
            <div class="muted">${player.totalScore} points</div>
            <div class="muted" style="font-size:.78rem;margin-top:8px;">
              Best round: ${player.stats?.bestRound || 0}<br>
              Busts: ${player.stats?.busts || 0}
            </div>
          </div>
        `).join("")}
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
  const roundChanged =
    previousRoundNumber !== null &&
    roomState.roundNumber !== previousRoundNumber;

  const phaseChanged =
    previousPhase !== null &&
    roomState.phase !== previousPhase;

  state = roomState;
  actionPending = false;
  actionError.textContent = "";

  if (roundChanged || (phaseChanged && roomState.phase === "playing")) {
    centreCard.className = "centre-card-placeholder";
    centreCard.removeAttribute("style");
    centreCard.textContent = "THE NEXT CARD";
    lastMessage = "";
  }

  previousRoundNumber = roomState.roundNumber;
  previousPhase = roomState.phase;
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
  if (actionPending) return;
  actionPending = true;
  startGameBtn.disabled = true;

  socket.emit("startGame", result => {
    if (!handleReply(result)) {
      actionPending = false;
      render();
    }
  });
});

flipBtn.addEventListener("click", () => {
  if (actionPending) return;
  actionPending = true;
  flipBtn.disabled = true;
  bankBtn.disabled = true;

  socket.emit("flipCard", result => {
    if (!handleReply(result)) {
      actionPending = false;
      render();
    }
  });
});

bankBtn.addEventListener("click", () => {
  if (actionPending) return;
  actionPending = true;
  flipBtn.disabled = true;
  bankBtn.disabled = true;

  socket.emit("bankScore", result => {
    if (!handleReply(result)) {
      actionPending = false;
      render();
    }
  });
});

nextRoundBtn.addEventListener("click", () => {
  if (actionPending) return;
  actionPending = true;
  nextRoundBtn.disabled = true;
  actionError.textContent = "";

  socket.emit("nextRound", result => {
    if (!handleReply(result)) {
      actionPending = false;
      render();
    }
  });
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


document.querySelectorAll("[data-reaction]").forEach(button => {
  button.addEventListener("click", () => {
    const emoji = button.dataset.reaction;
    socket.emit("sendReaction", { emoji }, result => {
      if (result?.ok) {
        playTone(840, .08);
      }
    });
  });
});
