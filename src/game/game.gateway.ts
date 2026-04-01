import { WebSocketGateway, SubscribeMessage, MessageBody, ConnectedSocket, WebSocketServer } from '@nestjs/websockets';
import { GameService } from './game.service';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';

@WebSocketGateway({
  cors: { origin: '*' },
  path: '/api/socket.io' // Esto debe coincidir con lo que busque el front
})
export class GameGateway {
  constructor(private readonly gameService: GameService) {}

  @WebSocketServer() server: Server;

  // Optimized Redis connection for Railway
  private redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000
  });

@SubscribeMessage('create_lobby')
async handleCreateLobbby(
  @ConnectedSocket() cliente: Socket,
  @MessageBody() data: { startNode: any, targetNode: any } // Recibimos la config
) {
  const lobbyCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  // Guardamos el objeto completo como String en un Hash de Redis
  await this.redis.hset(`lobby:${lobbyCode}`, {
    status: 'waiting',
    startNode: JSON.stringify(data.startNode),
    targetNode: JSON.stringify(data.targetNode)
  });
  
  await this.redis.expire(`lobby:${lobbyCode}`, 1800); // 30 min

  cliente.join(lobbyCode);
  
  // Devolvemos el código al creador
  return { event: 'lobby_created', lobbyCode };
}

  @SubscribeMessage('join_lobby')
async handleJoinLobby(
  @MessageBody() data: { code: string, username: string },
  @ConnectedSocket() client: Socket
) {
  // 1. Buscamos toda la info del lobby en Redis
  const lobbyData = await this.redis.hgetall(`lobby:${data.code}`);
  
  if (lobbyData && lobbyData.status) {
    (client as any).username = data.username;
    client.join(data.code);

    // 2. Guardar jugador y puntaje inicial
    await this.redis.sadd(`lobby:${data.code}:players`, data.username);
    await this.redis.zadd(`lobby:${data.code}:scores`, 0, data.username);

    const playerCount = await this.redis.scard(`lobby:${data.code}:players`);

    // 3. Notificar a los demás
    this.server.to(data.code).emit('player_joined', {
      username: data.username,
      players: playerCount
    });

    // 4. RETORNAR LOS NODOS AL FRONTEND (Muy importante)
    // Usamos JSON.parse porque en Redis los guardamos como String
    return { 
      status: 'success', 
      startNode: JSON.parse(lobbyData.startNode), 
      targetNode: JSON.parse(lobbyData.targetNode) 
    };
  } else {
    return { status: 'error', message: 'Lobby no encontrado o expirado' };
  }
}

  @SubscribeMessage('submit_chain')
  async handleChain(
    @MessageBody() data: { lobby: string; chain: { id: string; type: 'person' | 'movie' }[] },
    @ConnectedSocket() client: Socket,
  ) {
    const username = (client as any).username;
    if (!username) return { status: 'error', message: 'User not identified' };

    // Validate connection through TMDB
    const isChainValid = await this.gameService.validateFullChain(data.chain);

    if (!isChainValid) {
      return this.server.to(data.lobby).emit('round_result', {
        username,
        score: 0,
        message: "Nice try! That connection doesn't exist in our records.",
      });
    }

    const steps = data.chain.filter((item) => item.type === 'movie').length;
    let finalScore = 0;
    let message = '';

    if (steps <= 6) {
      finalScore = 100 + (6 - steps) * 20;
      message = this.gameService.getWinMessage(steps);
    } else {
      finalScore = 10;
      message = this.gameService.getRoastMessage(steps);
    }

    // Update global ranking for this lobby
    await this.redis.zincrby(`lobby:${data.lobby}:scores`, finalScore, username);

    this.server.to(data.lobby).emit('round_result', {
      username,
      score: finalScore,
      message,
    });
  }
  @SubscribeMessage('get_ranking')
async handleGetRanking(@MessageBody() data: { lobby: string }) {
  // Trae los nombres y puntajes ordenados de mayor a menor
  const scores = await this.redis.zrevrange(`lobby:${data.lobby}:scores`, 0, -1, 'WITHSCORES');
  
  // scores viene como ['user1', '120', 'user2', '80'] -> Hay que formatearlo
  const formatted: { username: string; score: number }[] = [];
  for (let i = 0; i < scores.length; i += 2) {
    formatted.push({ username: scores[i], score: parseInt(scores[i+1]) });
  }
  
  return formatted;
}
}