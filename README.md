# Flip 9 v2

A polished online multiplayer party game built with Node.js, Express and Socket.IO.

## Features

- Create and join private rooms
- Five-character room codes
- Up to 10 players
- Separate devices
- Live synchronised turns
- Host controls
- Animated cards
- Sound effects
- Mobile-first design
- Automatic reconnect after refresh or brief connection loss
- Shared scoreboard
- Flip, bank, bust and Flip 9 bonus
- Render deployment configuration included

## Correct project structure

```text
flip9-v2/
├── public/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── package.json
├── render.yaml
├── README.md
└── server.js
```

Keep the `public` folder exactly as shown.

## Test locally

Install Node.js 18 or newer, then run:

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Deploy to Render

### Option A: Render Blueprint

1. Upload this complete folder to a GitHub repository.
2. In Render, choose **New → Blueprint**.
3. Connect the GitHub repository.
4. Render will detect `render.yaml`.
5. Approve the service and deploy.

### Option B: Web Service

Use:

```text
Runtime: Node
Build command: npm install
Start command: npm start
Plan: Free
```

Leave Root Directory blank if these files are at the repository root.

## Important

The game stores rooms in server memory. A Render restart clears active rooms. This is suitable for playing with friends. A larger public release should use Redis or a database.
