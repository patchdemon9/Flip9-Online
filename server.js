const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const WINNING_SCORE = 200;
const FLIP_9_BONUS = 25;
const ROOM_EXPIRY_MS = 1000 * 60 * 60 * 6;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function createPlayerToken() {
  return crypto.randomBytes(18).toString("hex");
}

function touch(room) {
  room.updatedAt = Date.now();
}

function createDeck() {
  const deck = [];

  for (let number = 1; number <= 9; number += 1) {
    for (let copy = 0; copy < number; copy += 1) {
      deck.push(number);
    }
  }

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[randomIndex]] = [deck[randomIndex], deck[index]];
  }

  return deck;
}

function roundScore(player) {
  if (player.busted) return 0;

  const cardTotal = player.roundCards.reduce((sum, card) => sum + card, 0);
  return cardTotal + (player.completedFlip9 ? FLIP_9_BONUS : 0);
}

function publicRoomState(room, viewerToken) {
  const viewer = room.players.find(player => player.token === viewerToken);

  return {
    code: room.code,
    phase: room.phase,
    roundNumber: room.roundNumber,
    currentPlayerToken: room.currentPlayerToken,
    winnerToken: room.winnerToken,
    hostToken: room.hostToken,
    message: room.message,
    deckCount: room.deck.length,
    viewerToken: viewer?.token || null,
    players: room.players.map(player => ({
      token: player.token,
      name: player.name,
      connected: player.connected,
      totalScore: player.totalScore,
      roundCards: player.roundCards,
      banked: player.banked,
      busted: player.busted,
      completedFlip9: player.completedFlip9
    }))
  };
}

function emitRoom(room) {
  touch(room);

  for (const player of room.players) {
    if (!player.socketId) continue;

    io.to(player.socketId).emit(
      "roomState",
      publicRoomState(room, player.token)
    );
  }
}

function getRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

function getSocketPlayer(socket, room) {
  return room?.players.find(player => player.token === socket.data.playerToken);
}

function getCurrentPlayer(room) {
  return room.players.find(player => player.token === room.currentPlayerToken);
}

function activePlayers(room) {
  return room.players.filter(
    player => player.connected && !player.banked && !player.busted
  );
}

function beginRound(room) {
  room.deck = createDeck();
  room.phase = "playing";
  room.winnerToken = null;

  for (const player of room.players) {
    player.roundCards = [];
    player.banked = false;
    player.busted = false;
    player.completedFlip9 = false;
  }

  const firstConnected = room.players.find(player => player.connected);
  room.currentPlayerToken = firstConnected?.token || null;
  room.message = `Round ${room.roundNumber} has started.`;
}

function advanceTurn(room) {
  const available = activePlayers(room);

  if (available.length === 0) {
    finishRound(room);
    return;
  }

  const currentIndex = room.players.findIndex(
    player => player.token === room.currentPlayerToken
  );

  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const next = room.players[(currentIndex + offset) % room.players.length];

    if (next.connected && !next.banked && !next.busted) {
      room.currentPlayerToken = next.token;
      return;
    }
  }
}

function finishRound(room) {
  for (const player of room.players) {
    player.totalScore += roundScore(player);
  }

  const winner = [...room.players]
    .sort((a, b) => b.totalScore - a.totalScore)
    .find(player => player.totalScore >= WINNING_SCORE);

  if (winner) {
    room.phase = "finished";
    room.winnerToken = winner.token;
    room.currentPlayerToken = null;
    room.message = `${winner.name} wins with ${winner.totalScore} points.`;
  } else {
    room.phase = "roundOver";
    room.currentPlayerToken = null;
    room.message = `Round ${room.roundNumber} is complete.`;
  }
}

function removeDisconnectedPlayerIfLobby(room, player) {
  if (room.phase !== "lobby") return false;

  room.players = room.players.filter(candidate => candidate.token !== player.token);

  if (room.hostToken === player.token) {
    room.hostToken = room.players[0]?.token || null;
  }

  return true;
}

function leaveCurrentRoom(socket, permanent = false) {
  const room = getRoom(socket);
  if (!room) return;

  const player = getSocketPlayer(socket, room);
  if (!player) return;

  if (permanent || room.phase === "lobby") {
    room.players = room.players.filter(candidate => candidate.token !== player.token);

    if (room.hostToken === player.token) {
      room.hostToken = room.players[0]?.token || null;
    }
  } else {
    player.connected = false;
    player.socketId = null;

    if (room.currentPlayerToken === player.token && room.phase === "playing") {
      player.busted = true;
      room.message = `${player.name} disconnected and was skipped.`;
      advanceTurn(room);
    }
  }

  socket.leave(room.code);
  socket.data.roomCode = null;
  socket.data.playerToken = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
  } else {
    emitRoom(room);
  }
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name }, reply) => {
    const cleanName = String(name || "").trim().slice(0, 20);

    if (!cleanName) {
      reply?.({ ok: false, error: "Enter your name first." });
      return;
    }

    leaveCurrentRoom(socket, true);

    const token = createPlayerToken();
    const code = makeRoomCode();

    const room = {
      code,
      phase: "lobby",
      roundNumber: 1,
      currentPlayerToken: null,
      winnerToken: null,
      hostToken: token,
      message: "Room created.",
      deck: [],
      updatedAt: Date.now(),
      players: [{
        token,
        socketId: socket.id,
        name: cleanName,
        connected: true,
        totalScore: 0,
        roundCards: [],
        banked: false,
        busted: false,
        completedFlip9: false
      }]
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerToken = token;

    reply?.({ ok: true, code, token });
    emitRoom(room);
  });

  socket.on("joinRoom", ({ name, code }, reply) => {
    const cleanName = String(name || "").trim().slice(0, 20);
    const cleanCode = String(code || "").trim().toUpperCase();

    if (!cleanName || !cleanCode) {
      reply?.({ ok: false, error: "Enter your name and room code." });
      return;
    }

    const room = rooms.get(cleanCode);

    if (!room) {
      reply?.({ ok: false, error: "That room does not exist." });
      return;
    }

    if (room.phase !== "lobby") {
      reply?.({ ok: false, error: "That game has already started." });
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      reply?.({ ok: false, error: "That room is full." });
      return;
    }

    if (room.players.some(player => player.name.toLowerCase() === cleanName.toLowerCase())) {
      reply?.({ ok: false, error: "That name is already being used." });
      return;
    }

    leaveCurrentRoom(socket, true);

    const token = createPlayerToken();

    room.players.push({
      token,
      socketId: socket.id,
      name: cleanName,
      connected: true,
      totalScore: 0,
      roundCards: [],
      banked: false,
      busted: false,
      completedFlip9: false
    });

    socket.join(cleanCode);
    socket.data.roomCode = cleanCode;
    socket.data.playerToken = token;
    room.message = `${cleanName} joined the room.`;

    reply?.({ ok: true, code: cleanCode, token });
    emitRoom(room);
  });

  socket.on("reconnectPlayer", ({ code, token }, reply) => {
    const cleanCode = String(code || "").trim().toUpperCase();
    const room = rooms.get(cleanCode);
    const player = room?.players.find(candidate => candidate.token === token);

    if (!room || !player) {
      reply?.({ ok: false });
      return;
    }

    leaveCurrentRoom(socket, true);

    player.connected = true;
    player.socketId = socket.id;

    socket.join(cleanCode);
    socket.data.roomCode = cleanCode;
    socket.data.playerToken = token;

    room.message = `${player.name} reconnected.`;

    reply?.({ ok: true, code: cleanCode, token });
    emitRoom(room);
  });

  socket.on("startGame", reply => {
    const room = getRoom(socket);
    const player = getSocketPlayer(socket, room);

    if (!room || !player || room.hostToken !== player.token) {
      reply?.({ ok: false, error: "Only the host can start the game." });
      return;
    }

    const connectedPlayers = room.players.filter(candidate => candidate.connected);

    if (connectedPlayers.length < 2) {
      reply?.({ ok: false, error: "At least two connected players are required." });
      return;
    }

    for (const candidate of room.players) {
      candidate.totalScore = 0;
    }

    room.roundNumber = 1;
    beginRound(room);

    reply?.({ ok: true });
    emitRoom(room);
  });

  socket.on("flipCard", reply => {
    const room = getRoom(socket);
    const player = getSocketPlayer(socket, room);

    if (!room || !player || room.phase !== "playing") {
      reply?.({ ok: false, error: "The game is not active." });
      return;
    }

    if (room.currentPlayerToken !== player.token) {
      reply?.({ ok: false, error: "It is not your turn." });
      return;
    }

    if (room.deck.length === 0) {
      room.deck = createDeck();
    }

    const card = room.deck.pop();

    if (player.roundCards.includes(card)) {
      player.busted = true;
      room.message = `${player.name} flipped another ${card} and busted.`;
      advanceTurn(room);
    } else {
      player.roundCards.push(card);
      room.message = `${player.name} flipped a ${card}.`;

      if (new Set(player.roundCards).size === 9) {
        player.completedFlip9 = true;
        player.banked = true;
        room.message = `${player.name} completed Flip 9 and earned a ${FLIP_9_BONUS}-point bonus.`;
        advanceTurn(room);
      }
    }

    reply?.({ ok: true, card });
    emitRoom(room);
  });

  socket.on("bankScore", reply => {
    const room = getRoom(socket);
    const player = getSocketPlayer(socket, room);

    if (!room || !player || room.phase !== "playing") {
      reply?.({ ok: false, error: "The game is not active." });
      return;
    }

    if (room.currentPlayerToken !== player.token) {
      reply?.({ ok: false, error: "It is not your turn." });
      return;
    }

    if (player.roundCards.length === 0) {
      reply?.({ ok: false, error: "Flip at least one card first." });
      return;
    }

    player.banked = true;
    room.message = `${player.name} banked ${roundScore(player)} points.`;
    advanceTurn(room);

    reply?.({ ok: true });
    emitRoom(room);
  });

  socket.on("nextRound", reply => {
    const room = getRoom(socket);
    const player = getSocketPlayer(socket, room);

    if (!room || !player || room.hostToken !== player.token) {
      reply?.({ ok: false, error: "Only the host can start the next round." });
      return;
    }

    if (room.phase !== "roundOver") {
      reply?.({ ok: false, error: "The current round is not over." });
      return;
    }

    room.roundNumber += 1;
    beginRound(room);

    reply?.({ ok: true });
    emitRoom(room);
  });

  socket.on("leaveRoom", () => {
    leaveCurrentRoom(socket, true);
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket);
    const player = getSocketPlayer(socket, room);

    if (!room || !player) return;

    if (removeDisconnectedPlayerIfLobby(room, player)) {
      socket.data.roomCode = null;
      socket.data.playerToken = null;

      if (room.players.length === 0) {
        rooms.delete(room.code);
      } else {
        emitRoom(room);
      }

      return;
    }

    player.connected = false;
    player.socketId = null;

    if (room.phase === "playing" && room.currentPlayerToken === player.token) {
      player.busted = true;
      room.message = `${player.name} disconnected and was skipped.`;
      advanceTurn(room);
    }

    emitRoom(room);
  });
});

setInterval(() => {
  const now = Date.now();

  for (const [code, room] of rooms.entries()) {
    if (now - room.updatedAt > ROOM_EXPIRY_MS) {
      rooms.delete(code);
    }
  }
}, 1000 * 60 * 30);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Flip 9 is running on port ${PORT}`);
});
