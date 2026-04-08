# The Six Degrees - Backend 🎬

This is the backend for **The Six Degrees**, a movie-themed social game where players connect actors and movies in a chain to reach a target. Built with **NestJS**, **WebSockets**, and **Redis**, it leverages the **TMDB API** for movie data validation.

## 🚀 Key Features

- **Real-time Multiplayer**: Powered by Socket.io for lobby management and instant game updates.
- **Dynamic Contextual Search**: A guided search system that only allows valid connections based on the current node (e.g., if you pick an actor, you can only search for movies they've been in).
- **Intelligent Chain Validation**: Validates user-submitted chains against TMDB credits with built-in rate-limiting protection.
- **Live Ranking & Scoring**: Integrated scoring system with Redis-backed leaderboards that update in real-time.
- **Host Authority**: Robust lobby management where the creator has exclusive rights to start games and update missions.

## 🛠️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/)
- **Communication**: [Socket.io](https://socket.io/) (WebSockets)
- **Database/Caching**: [Redis](https://redis.io/) (via ioredis)
- **API Client**: [Axios](https://axios-http.com/)
- **Language**: TypeScript
- **External API**: [The Movie Database (TMDB)](https://www.themoviedb.org/documentation/api)

## 📦 Project Structure

```text
src/
├── game/
│   ├── game.controller.ts  # REST Endpoints (Search & Connections)
│   ├── game.gateway.ts     # WebSocket Events (Lobby, Game Flow, Results)
│   ├── game.service.ts     # Core Logic (TMDB API, Validation, Scoring)
│   └── game.module.ts      # NestJS Module Configuration
├── main.ts                 # App entry point & CORS configuration
└── app.module.ts           # Root module
```

## 🌐 Live Demo
You can play the game live at: **[https://thesixdegrees.vercel.app](https://thesixdegrees.vercel.app)**

## ⚙️ Environment Variables
Create a `.env` file in the root directory:

```env
PORT=3000
TMDB_API_KEY=your_tmdb_api_key
REDIS_URL=redis://localhost:6379 # Or REDIS_PUBLIC_URL for production
```

## 📡 API & Socket Documentation

### REST Endpoints

#### `GET /api/game/search`
Global search for movies or actors (used for setting up the game).
- Params: `q` (query), `type` ('person' | 'movie')

#### `GET /api/game/connections`
Context-aware search for the current game step.
- Params: `contextId` (ID of last node), `contextType` ('person' | 'movie'), `q` (filter)

### WebSocket Events (Emitter/Listener)

- **`create_lobby`**: Initializes a new game room.
- **`join_lobby`**: Adds a player and syncs the current host and node data.
- **`start_game`**: Broadcasts the start event to all players in the room.
- **`submit_chain`**: Submits a completed chain for validation and scoring.
- **`update_mission`**: Allows the host to reset the mission for a new round without destroying the room.
- **`round_result`**: Broadcasted when a player finishes, sending updated rankings to everyone.

## 🏃 Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run in development mode**:
   ```bash
   npm run start:dev
   ```

3. **Build for production**:
   ```bash
   npm run build
   npm run start:prod
   ```

## 🛡️ CORS
The application is pre-configured to accept requests from the production frontend URL. You can update this in `src/main.ts`.

---
*Developed with ❤️ for movie buffs.*
