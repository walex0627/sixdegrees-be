import { WebSocketGateway, SubscribeMessage, MessageBody, ConnectedSocket, WebSocketServer } from '@nestjs/websockets';
import { GameService } from './game.service';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';

@WebSocketGateway({
  cors: { 
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'] 
})
export class GameGateway {
  constructor(private readonly gameService: GameService) {}

  @WebSocketServer() server: Server;

  private redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000
  });

  @SubscribeMessage('create_lobby')
  async handleCreateLobbby(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { startNode: any, targetNode: any, username: string }
  ) {
    const lobbyCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Store lobby configuration and host information
    await this.redis.hset(`lobby:${lobbyCode}`, {
      status: 'waiting',
      startNode: JSON.stringify(data.startNode),
      targetNode: JSON.stringify(data.targetNode),
      hostUsername: data.username
    });

    // Set lobby TTL to 30 minutes
    await this.redis.expire(`lobby:${lobbyCode}`, 1800);

    // Attach the username to the socket instance and join the room
    (client as any).username = data.username;
    client.join(lobbyCode);

    // Register the host in the players and scores sorted sets
    await this.redis.sadd(`lobby:${lobbyCode}:players`, data.username);
    await this.redis.zadd(`lobby:${lobbyCode}:scores`, 0, data.username);

    console.log(`Lobby created: ${lobbyCode} by ${data.username}`);
    
    return { lobbyCode };
  }

  @SubscribeMessage('join_lobby')
  async handleJoinLobby(
    @MessageBody() data: { code: string, username: string },
    @ConnectedSocket() client: Socket
  ) {
    const lobbyData = await this.redis.hgetall(`lobby:${data.code}`);
    
    if (lobbyData && lobbyData.status) {
      // Attach the username to the socket instance and join the room
      (client as any).username = data.username;
      client.join(data.code);

      // Register the new player in Redis (score defaults to 0)
      await this.redis.sadd(`lobby:${data.code}:players`, data.username);
      await this.redis.zadd(`lobby:${data.code}:scores`, 0, data.username);

      // Fetch the updated players array sorted by score (descending)
      const scores = await this.redis.zrevrange(`lobby:${data.code}:scores`, 0, -1, 'WITHSCORES');
      const players: { username: string; score: number }[] = [];
      for (let i = 0; i < scores.length; i += 2) {
        players.push({ username: scores[i], score: parseInt(scores[i+1]) });
      }

      // Broadcast the updated player list and host to all clients in the room
      this.server.to(data.code).emit('player_joined', {
        players,
        hostUsername: lobbyData.hostUsername
      });

      console.log(`Player ${data.username} joined lobby ${data.code}`);

      return { 
        status: 'success', 
        lobbyCode: data.code,
        startNode: JSON.parse(lobbyData.startNode), 
        targetNode: JSON.parse(lobbyData.targetNode),
        hostUsername: lobbyData.hostUsername,
        players
      };
    } else {
      return { status: 'error', message: 'Lobby not found' };
    }
  }

  @SubscribeMessage('start_game')
  async handleStartGame(@MessageBody() data: { lobby: string }) {
    await this.redis.hset(`lobby:${data.lobby}`, 'status', 'playing');

    // Fetch the full player list and host to sync all clients at game start
    const lobbyData = await this.redis.hgetall(`lobby:${data.lobby}`);
    const scores = await this.redis.zrevrange(`lobby:${data.lobby}:scores`, 0, -1, 'WITHSCORES');
    const players: { username: string; score: number }[] = [];
    for (let i = 0; i < scores.length; i += 2) {
      players.push({ username: scores[i], score: parseInt(scores[i+1]) });
    }

    this.server.to(data.lobby).emit('game_started', {
      players,
      hostUsername: lobbyData.hostUsername
    });
    console.log(`Game started in lobby: ${data.lobby}`);
  }

  @SubscribeMessage('submit_chain')
  async handleChain(
    @MessageBody() data: { lobby: string; username: string; chain: any[] },
    @ConnectedSocket() client: Socket,
  ) {
    const username = data.username || (client as any).username;

    try {
      // Step 1: Validate the submitted chain against the TMDB API
      const isChainValid = await this.gameService.validateFullChain(data.chain);

      // Step 2: Count the number of movie nodes (each movie = 1 step)
      const steps = data.chain.filter((item) => item.type === 'movie').length;

      let resultMessage: string;
      let finalScore = 0;

      // Step 3: Scoring logic based on chain validity and step count
      if (isChainValid) {
        if (steps <= 6) {
          resultMessage = this.gameService.getWinMessage(steps);
          // Pro scoring: 1 step = 250pts, 2–3 steps = 150pts, 4–6 steps = 100pts
          finalScore = steps === 1 ? 250 : (steps <= 3 ? 150 : 100);
        } else {
          resultMessage = this.gameService.getRoastMessage(steps);
          finalScore = 10;
        }

        // Step 4: Persist the score in Redis only for valid chains (incremental)
        await this.redis.zincrby(`lobby:${data.lobby}:scores`, finalScore, username);

      } else {
        resultMessage = `Cut! The Director says ${data.chain[0]?.name || 'that element'} was not in that production. Check your sources.`;
        finalScore = 0;
      }

      // Step 5: Fetch the updated ranking and broadcast round results to the entire lobby
      const scores = await this.redis.zrevrange(`lobby:${data.lobby}:scores`, 0, -1, 'WITHSCORES');
      const players: { username: string; score: number }[] = [];
      for (let i = 0; i < scores.length; i += 2) {
        players.push({ username: scores[i], score: parseInt(scores[i+1]) });
      }

      this.server.to(data.lobby).emit('round_result', {
        username,
        score: finalScore,
        message: resultMessage,
        players,
      });

    } catch (error) {
      console.error(`[submit_chain] Unexpected error for user ${username}:`, error.message);

      // Always emit round_result on error to prevent the client from freezing
      this.server.to(data.lobby).emit('round_result', {
        username,
        score: 0,
        message: `Technical cut! The server encountered an error validating your chain. Try a shorter chain.`,
        players: [],
        error: true,
      });
    }

    return { status: 'success' };
  }

  @SubscribeMessage('get_ranking')
  async handleGetRanking(@MessageBody() data: { lobby: string }) {
    const scores = await this.redis.zrevrange(`lobby:${data.lobby}:scores`, 0, -1, 'WITHSCORES');
    const formatted: { username: string; score: number }[] = [];
    for (let i = 0; i < scores.length; i += 2) {
      formatted.push({ username: scores[i], score: parseInt(scores[i+1]) });
    }
    return formatted;
  }

  @SubscribeMessage('update_mission')
  async handleUpdateMission(
    @MessageBody() data: { lobby_code: string, startNode: any, targetNode: any }
  ) {
    // Reset the lobby status to 'waiting' and persist the new mission nodes
    await this.redis.hset(`lobby:${data.lobby_code}`, {
      status: 'waiting',
      startNode: JSON.stringify(data.startNode),
      targetNode: JSON.stringify(data.targetNode)
    });

    // Broadcast the new mission to all clients currently in the room
    this.server.to(data.lobby_code).emit('mission_updated', {
      startNode: data.startNode,
      targetNode: data.targetNode
    });

    console.log(`Mission updated in lobby: ${data.lobby_code}`);
    return { status: 'success' };
  }
}