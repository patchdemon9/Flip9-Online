# Flip 9 Online

A real-time online multiplayer version of Flip 9 using Node.js, Express and Socket.IO.

## Features

- Create and join rooms with five-character room codes
- 2 to 10 players
- Separate devices
- Host-controlled game start and next rounds
- Server-controlled deck, turns and scoring
- Flip or bank score
- Bust on duplicate numbers
- Flip 9 bonus
- First to 200 points wins

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`.

To test on multiple devices connected to the same Wi-Fi network, run the server on your computer and open:

```text
http://YOUR-COMPUTER-IP:3000
```

on each phone.

## Put it online

Deploy the whole folder to a Node.js host such as Render, Railway, Fly.io or another provider that supports WebSockets.

Use:

- Build command: `npm install`
- Start command: `npm start`

The host must support persistent WebSocket connections.

## Current limitation

Room state is stored in server memory. Restarting the server clears all rooms. For a larger public release, add Redis or a database and reconnect tokens.
