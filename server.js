const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const WINNING_SCORE = 200;
const FLIP_9_BONUS = 25;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));

  return code;
}

function createDeck() {
  const deck = [];

  for (let number = 1; number <= 9; number++) {
    for (let copy = 0; copy < number; copy++) {
      deck.push(number);
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    currentPlayerId: room.currentPlayerId,
    winnerId: room.winnerId,
    message: room.message,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      totalScore: player.totalScore,
      roundCards: player.roundCards,
      banked: player.banked,
      busted: player.busted,
      completedFlip9: player.completedFlip9
    }))
  };
}

function emitRoom(room) {
  io.to(room.code).emit("roomState", publicRoomState(room));
}

function getRoomForSocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

function getCurrentPlayer(room) {
  return room.players.find(player => player.id === room.currentPlayerId);
}

function roundScore(player) {
  if (player.busted) return 0;

  const cardTotal = player.roundCards.reduce((sum, card) => sum + card, 0);
  return cardTotal + (player.completedFlip9 ? FLIP_9_BONUS : 0);
}

function beginRound(room) {
  room.deck = createDeck();
  room.phase = "playing";
  room.message = `Round ${room.roundNumber} has started.`;
  room.winnerId = null;

  room.players.forEach(player => {
    player.roundCards = [];
    player.banked = false;
    player.busted = false;
    player.completedFlip9 = false;
  });

  room.currentPlayerId = room.players[0]?.id || null;
}

function activePlayers(room) {
  return room.players.filter(player => !player.banked && !player.busted);
}

function advanceTurn(room) {
  const available = activePlayers(room);

  if (available.length === 0) {
    finishRound(room);
    return;
  }

  const currentIndex = room.players.findIndex(player => player.id === room.currentPlayerId);

  for (let offset = 1; offset <= room.players.length; offset++) {
    const next = room.players[(currentIndex + offset) % room.players.length];

    if (!next.banked && !next.busted) {
      room.currentPlayerId = next.id;
      return;
    }
  }
}

function finishRound(room) {
  room.players.forEach(player => {
    player.totalScore += roundScore(player);
  });

  const winner = [...room.players]
    .sort((a, b) => b.totalScore - a.totalScore)
    .find(player => player.totalScore >= WINNING_SCORE);

  if (winner) {
    room.phase = "finished";
    room.winnerId = winner.id;
    room.currentPlayerId = null;
    room.message = `${winner.name} wins with ${winner.totalScore} points.`;
  } else {
    room.phase = "roundOver";
    room.currentPlayerId = null;
    room.message = `Round ${room.roundNumber} is complete.`;
  }
}

function removePlayerFromRoom(socket) {
  const room = getRoomForSocket(socket);
  if (!room) return;

  const leavingPlayer = room.players.find(player => player.id === socket.id);
  room.players = room.players.filter(player => player.id !== socket.id);
  socket.leave(room.code);
  socket.data.roomCode = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
  }

  if (room.currentPlayerId === socket.id && room.phase === "playing") {
    room.message = `${leavingPlayer?.name || "A player"} left the room.`;
    advanceTurn(room);
  }

  emitRoom(room);
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name }, reply) => {
    const cleanName = String(name || "").trim().slice(0, 20);

    if (!cleanName) {
      reply?.({ ok: false, error: "Enter a player name." });
      return;
    }

    removePlayerFromRoom(socket);

    const code = makeRoomCode();
    const room = {
      code,
      hostId: socket.id,
      phase: "lobby",
      roundNumber: 1,
      currentPlayerId: null,
      winnerId: null,
      message: "Room created.",
      deck: [],
      players: [{
        id: socket.id,
        name: cleanName,
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

    reply?.({ ok: true, code });
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
      reply?.({ ok: false, error: "That name is already being used in this room." });
      return;
    }

    removePlayerFromRoom(socket);

    room.players.push({
      id: socket.id,
      name: cleanName,
      totalScore: 0,
      roundCards: [],
      banked: false,
      busted: false,
      completedFlip9: false
    });

    socket.join(cleanCode);
    socket.data.roomCode = cleanCode;
    room.message = `${cleanName} joined the room.`;

    reply?.({ ok: true, code: cleanCode });
    emitRoom(room);
  });

  socket.on("startGame", reply => {
    const room = getRoomForSocket(socket);

    if (!room || room.hostId !== socket.id) {
      reply?.({ ok: false, error: "Only the host can start the game." });
      return;
    }

    if (room.players.length < 2) {
      reply?.({ ok: false, error: "At least two players are required." });
      return;
    }

    room.players.forEach(player => {
      player.totalScore = 0;
    });

    room.roundNumber = 1;
    beginRound(room);

    reply?.({ ok: true });
    emitRoom(room);
  });

  socket.on("flipCard", reply => {
    const room = getRoomForSocket(socket);

    if (!room || room.phase !== "playing") {
      reply?.({ ok: false, error: "The game is not currently active." });
      return;
    }

    if (room.currentPlayerId !== socket.id) {
      reply?.({ ok: false, error: "It is not your turn." });
      return;
    }

    const player = getCurrentPlayer(room);

    if (!player || player.banked || player.busted) {
      reply?.({ ok: false, error: "You cannot flip right now." });
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
    const room = getRoomForSocket(socket);

    if (!room || room.phase !== "playing") {
      reply?.({ ok: false, error: "The game is not currently active." });
      return;
    }

    if (room.currentPlayerId !== socket.id) {
      reply?.({ ok: false, error: "It is not your turn." });
      return;
    }

    const player = getCurrentPlayer(room);

    if (!player || player.roundCards.length === 0) {
      reply?.({ ok: false, error: "Flip at least one card before banking." });
      return;
    }

    player.banked = true;
    room.message = `${player.name} banked ${roundScore(player)} points.`;
    advanceTurn(room);

    reply?.({ ok: true });
    emitRoom(room);
  });

  socket.on("nextRound", reply => {
    const room = getRoomForSocket(socket);

    if (!room || room.hostId !== socket.id) {
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
    removePlayerFromRoom(socket);
  });

  socket.on("disconnect", () => {
    removePlayerFromRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Flip 9 is running on http://localhost:${PORT}`);
});
