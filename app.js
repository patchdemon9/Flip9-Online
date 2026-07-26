const socket = io();

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
const handArea = document.getElementById("handArea");
const flipBtn = document.getElementById("flipBtn");
const bankBtn = document.getElementById("bankBtn");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const actionError = document.getElementById("actionError");

function callbackHandler(result) {
  if (!result?.ok) {
    homeError.textContent = result?.error || "Something went wrong.";
  }
}

function createRoom() {
  homeError.textContent = "";
  socket.emit("createRoom", { name: nameInput.value }, callbackHandler);
}

function joinRoom() {
  homeError.textContent = "";
  socket.emit(
    "joinRoom",
    {
      name: nameInput.value,
      code: roomCodeInput.value
    },
    callbackHandler
  );
}

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

function render() {
  if (!state) return;

  homeView.classList.add("hidden");
  roomView.classList.remove("hidden");

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
  roundBadge.textContent = state.phase === "lobby" ? `${state.players.length}/10 players` : `Round ${state.roundNumber}`;

  const me = state.players.find(player => player.id === socket.id);
  const current = state.players.find(player => player.id === state.currentPlayerId);
  const winner = state.players.find(player => player.id === state.winnerId);
  const isHost = state.hostId === socket.id;
  const isMyTurn = state.currentPlayerId === socket.id && state.phase === "playing";

  playersGrid.innerHTML = state.players.map(player => `
    <article class="player-card
      ${player.id === state.currentPlayerId ? "active" : ""}
      ${player.banked || player.busted ? "done" : ""}
      ${player.id === socket.id ? "me" : ""}">
      <div class="player-name">${escapeHtml(player.name)}${player.id === state.hostId ? " 👑" : ""}</div>
      <div class="score-row"><span>Total</span><strong>${player.totalScore}</strong></div>
      <div class="score-row"><span>Round</span><strong>${score(player)}</strong></div>
      <div class="score-row"><span>Status</span><strong>${playerState(player)}</strong></div>
    </article>
  `).join("");

  if (state.phase === "lobby") {
    lobbyControls.classList.remove("hidden");
    gameArea.classList.add("hidden");
    mainStatus.textContent = isHost ? "Your room is ready" : "Waiting for the host";
    lobbyHint.textContent = isHost
      ? "Share the room code. You can start with 2–10 players."
      : "The host will start the game when everyone has joined.";
    startGameBtn.classList.toggle("hidden", !isHost);
    startGameBtn.disabled = state.players.length < 2;
    return;
  }

  lobbyControls.classList.add("hidden");
  gameArea.classList.remove("hidden");

  if (state.phase === "playing") {
    mainStatus.textContent = isMyTurn
      ? "It’s your turn"
      : `${current?.name || "Another player"} is playing`;

    turnBanner.textContent = isMyTurn
      ? "Choose carefully…"
      : `Waiting for ${current?.name || "the next player"}`;

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
    turnBanner.textContent = isHost ? "Start the next round when everyone is ready." : "Waiting for the host.";
    handArea.innerHTML = [...state.players]
      .sort((a, b) => score(b) - score(a))
      .map(player => `
        <article class="player-card" style="width:180px;text-align:left;">
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
        <div style="font-size:2rem;font-weight:950;">${escapeHtml(winner?.name || "")}</div>
        <div class="muted">${winner?.totalScore || 0} points</div>
      </div>
    `;

    flipBtn.classList.add("hidden");
    bankBtn.classList.add("hidden");
    nextRoundBtn.classList.add("hidden");
  }
}

socket.on("roomState", roomState => {
  state = roomState;
  actionError.textContent = "";
  render();
});

socket.on("disconnect", () => {
  actionError.textContent = "Connection lost. Trying to reconnect…";
});

socket.on("connect", () => {
  actionError.textContent = "";
});

createBtn.addEventListener("click", createRoom);
joinBtn.addEventListener("click", joinRoom);

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

roomCodeInput.addEventListener("keydown", event => {
  if (event.key === "Enter") joinRoom();
});

nameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") createRoom();
});

startGameBtn.addEventListener("click", () => {
  socket.emit("startGame", result => {
    if (!result?.ok) actionError.textContent = result?.error || "Could not start the game.";
  });
});

flipBtn.addEventListener("click", () => {
  socket.emit("flipCard", result => {
    if (!result?.ok) actionError.textContent = result?.error || "Could not flip a card.";
  });
});

bankBtn.addEventListener("click", () => {
  socket.emit("bankScore", result => {
    if (!result?.ok) actionError.textContent = result?.error || "Could not bank the score.";
  });
});

nextRoundBtn.addEventListener("click", () => {
  socket.emit("nextRound", result => {
    if (!result?.ok) actionError.textContent = result?.error || "Could not start the next round.";
  });
});

copyCodeBtn.addEventListener("click", async () => {
  if (!state) return;
  await navigator.clipboard.writeText(state.code);
  copyCodeBtn.textContent = "COPIED";
  setTimeout(() => {
    if (state) copyCodeBtn.textContent = state.code;
  }, 900);
});

shareBtn.addEventListener("click", async () => {
  if (!state) return;
  const url = `${location.origin}/?room=${state.code}`;
  await navigator.clipboard.writeText(url);
  shareBtn.textContent = "Link Copied";
  setTimeout(() => {
    shareBtn.textContent = "Copy Invite Link";
  }, 900);
});

leaveBtn.addEventListener("click", () => {
  socket.emit("leaveRoom");
  state = null;
  roomView.classList.add("hidden");
  homeView.classList.remove("hidden");
  history.replaceState({}, "", location.pathname);
});

const roomFromUrl = new URLSearchParams(location.search).get("room");
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.toUpperCase().slice(0, 5);
}
