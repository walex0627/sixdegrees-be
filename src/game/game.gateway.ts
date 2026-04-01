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
    @ConnectedSocket() cliente: Socket,
    @MessageBody() data: { startNode: any, targetNode: any }
  ) {
    // Generamos código alfanumérico de 6 dígitos
    const lobbyCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Guardamos la configuración inicial
    await this.redis.hset(`lobby:${lobbyCode}`, {
      status: 'waiting',
      startNode: JSON.stringify(data.startNode),
      targetNode: JSON.stringify(data.targetNode)
    });
    
    await this.redis.expire(`lobby:${lobbyCode}`, 1800); 

    cliente.join(lobbyCode);
    
    // IMPORTANTE: Retornamos el objeto tal cual lo espera el handleJoin de App.tsx
    return { lobbyCode };
  }

  @SubscribeMessage('join_lobby')
  async handleJoinLobby(
    @MessageBody() data: { code: string, username: string },
    @ConnectedSocket() client: Socket
  ) {
    const lobbyData = await this.redis.hgetall(`lobby:${data.code}`);
    
    // Verificamos si existe el status para confirmar que el lobby es válido
    if (lobbyData && lobbyData.status) {
      (client as any).username = data.username;
      client.join(data.code);

      await this.redis.sadd(`lobby:${data.code}:players`, data.username);
      await this.redis.zadd(`lobby:${data.code}:scores`, 0, data.username);

      const playerCount = await this.redis.scard(`lobby:${data.code}:players`);

      // Notificamos a los que ya estaban
      this.server.to(data.code).emit('player_joined', {
        username: data.username,
        players: playerCount
      });

      // Retornamos los nodos para que el que se une vea el desafío
      return { 
        status: 'success', 
        startNode: JSON.parse(lobbyData.startNode), 
        targetNode: JSON.parse(lobbyData.targetNode) 
      };
    } else {
      return { status: 'error', message: 'Lobby no encontrado o expirado' };
    }
  }

  @SubscribeMessage('start_game')
  async handleStartGame(@MessageBody() data: { lobby: string }) {
    await this.redis.hset(`lobby:${data.lobby}`, 'status', 'playing');
    // Avisamos a todos que la pantalla debe cambiar
    this.server.to(data.lobby).emit('game_started');
  }

  @SubscribeMessage('submit_chain')
  async handleChain(
    @MessageBody() data: { lobby: string; chain: { id: string; type: 'person' | 'movie' }[] },
    @ConnectedSocket() client: Socket,
  ) {
    // 1. Recuperar el username (del socket o del handshake)
    const username = (client as any).username || client.handshake.auth?.username;
    
    if (!username) {
      return { status: 'error', message: 'User not identified' };
    }

    console.log(`Validando cadena para ${username} en lobby ${data.lobby}`);

    // 2. Validar la cadena con el servicio
    const isChainValid = await this.gameService.validateFullChain(data.chain);

    if (!isChainValid) {
      // Notificamos a todos en el lobby que este usuario falló
      this.server.to(data.lobby).emit('round_result', {
        username,
        score: 0,
        message: "¡Tramposo! Esa conexión no existe en los registros.",
      });
      return { status: 'invalid' };
    }

    // 3. Calcular puntos (basado en películas/pasos)
    const steps = data.chain.filter((item) => item.type === 'movie').length;
    let finalScore = 0;

    if (steps <= 6) {
      finalScore = 100 + (6 - steps) * 20;
    } else {
      finalScore = 10;
    }

    // 4. Actualizar ranking en Redis
    try {
      await this.redis.zincrby(`lobby:${data.lobby}:scores`, finalScore, username);
    } catch (error) {
      console.error("Error actualizando Redis:", error);
    }

    // 5. Generar mensaje (Roast o Win)
    const resultMessage = steps <= 6 
      ? this.gameService.getWinMessage(steps) 
      : this.gameService.getRoastMessage(steps);

    // 6. EMISIÓN CRÍTICA: Notificar a toda la sala
    // Usamos broadcast para asegurar que el mensaje baje a todos los clientes
    this.server.to(data.lobby).emit('round_result', {
      username,
      score: finalScore,
      message: resultMessage,
    });

    // 7. Respuesta de confirmación al cliente que envió (opcional)
    return { status: 'success', score: finalScore };
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