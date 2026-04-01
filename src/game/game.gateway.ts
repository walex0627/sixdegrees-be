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

    // Guardamos la configuración y el creador
    await this.redis.hset(`lobby:${lobbyCode}`, {
      status: 'waiting',
      startNode: JSON.stringify(data.startNode),
      targetNode: JSON.stringify(data.targetNode)
    });
    
    await this.redis.expire(`lobby:${lobbyCode}`, 1800); 

    // Identificamos al creador en el socket
    (client as any).username = data.username;
    client.join(lobbyCode);

    // Inicializamos al creador en las listas de Redis
    await this.redis.sadd(`lobby:${lobbyCode}:players`, data.username);
    await this.redis.zadd(`lobby:${lobbyCode}:scores`, 0, data.username);

    console.log(`Lobby creado: ${lobbyCode} por ${data.username}`);
    
    return { lobbyCode };
  }

  @SubscribeMessage('join_lobby')
  async handleJoinLobby(
    @MessageBody() data: { code: string, username: string },
    @ConnectedSocket() client: Socket
  ) {
    const lobbyData = await this.redis.hgetall(`lobby:${data.code}`);
    
    if (lobbyData && lobbyData.status) {
      (client as any).username = data.username;
      client.join(data.code);

      await this.redis.sadd(`lobby:${data.code}:players`, data.username);
      await this.redis.zadd(`lobby:${data.code}:scores`, 0, data.username);

      const playerCount = await this.redis.scard(`lobby:${data.code}:players`);

      // Notificamos a la sala
      this.server.to(data.code).emit('player_joined', {
        username: data.username,
        players: playerCount
      });

      console.log(`Jugador ${data.username} unido al lobby ${data.code}`);

      return { 
        status: 'success', 
        startNode: JSON.parse(lobbyData.startNode), 
        targetNode: JSON.parse(lobbyData.targetNode) 
      };
    } else {
      return { status: 'error', message: 'Lobby no encontrado' };
    }
  }

  @SubscribeMessage('start_game')
  async handleStartGame(@MessageBody() data: { lobby: string }) {
    await this.redis.hset(`lobby:${data.lobby}`, 'status', 'playing');
    this.server.to(data.lobby).emit('game_started');
    console.log(`Juego iniciado en lobby: ${data.lobby}`);
  }

 @SubscribeMessage('submit_chain')
async handleChain(
  @MessageBody() data: { lobby: string; username: string; chain: any[] },
  @ConnectedSocket() client: Socket,
) {
  const username = data.username || (client as any).username;
  const isChainValid = await this.gameService.validateFullChain(data.chain);

  const steps = data.chain.filter((item) => item.type === 'movie').length;
  
  // Aquí es donde el Backend decide el mensaje
  const resultMessage = isChainValid 
    ? (steps <= 6 ? this.gameService.getWinMessage(steps) : this.gameService.getRoastMessage(steps))
    : "¡Tramposo! Esa conexión no existe.";

  const payload = {
    username,
    score: isChainValid ? (steps <= 6 ? 100 : 10) : 0,
    message: resultMessage,
  };

  // EMITIMOS SOLO UNA VEZ A LA SALA
  this.server.to(data.lobby).emit('round_result', payload);

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
}