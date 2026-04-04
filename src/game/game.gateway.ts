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

      // Obtener arreglo de jugadores actualizado
      const scores = await this.redis.zrevrange(`lobby:${data.code}:scores`, 0, -1, 'WITHSCORES');
      const players: { username: string; score: number }[] = [];
      for (let i = 0; i < scores.length; i += 2) {
        players.push({ username: scores[i], score: parseInt(scores[i+1]) });
      }

      // Notificamos a toda la sala de la llegada del nuevo jugador con el array
      this.server.to(data.code).emit('player_joined', {
        players
      });

      console.log(`Jugador ${data.username} unido al lobby ${data.code}`);

      return { 
        status: 'success', 
        startNode: JSON.parse(lobbyData.startNode), 
        targetNode: JSON.parse(lobbyData.targetNode),
        players
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
  
  // 1. Validar la cadena
  const isChainValid = await this.gameService.validateFullChain(data.chain);

  // 2. Contar pasos (películas)
  const steps = data.chain.filter((item) => item.type === 'movie').length;

  let resultMessage: string;
  let finalScore = 0;

  // 3. LÓGICA DE EVALUACIÓN
  if (isChainValid) {
    // Si la cadena es válida, SIEMPRE damos Win Message si son pocos pasos
    if (steps <= 6) {
      resultMessage = this.gameService.getWinMessage(steps);
      // Puntuación Pro: 1 paso = 250, 2-3 = 150, 4-6 = 100
      finalScore = steps === 1 ? 250 : (steps <= 3 ? 150 : 100);
    } else {
      resultMessage = this.gameService.getRoastMessage(steps);
      finalScore = 10;
    }
    
    // 4. Guardar en Redis SOLO si es válida
    await this.redis.zincrby(`lobby:${data.lobby}:scores`, finalScore, username);
    
  } else {
    // SI LA VALIDACIÓN FALLA: 
    // Mandamos un mensaje especial del Director para errores de conexión
    resultMessage = `¡Corte! El Director dice que ${data.chain[0].name} no estuvo en esa producción. Revisa tus fuentes.`;
    finalScore = 0;
  }

  // 5. Obtener ranking actualizado y emitir el resultado
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
    // 1. Restaurar estatus de la sala a "waiting" (no jugando) y guardar los nuevos nodos
    await this.redis.hset(`lobby:${data.lobby_code}`, {
      status: 'waiting',
      startNode: JSON.stringify(data.startNode),
      targetNode: JSON.stringify(data.targetNode)
    });

    // 2. Emitir el nuevo evento a todos los clientes de esa sala
    this.server.to(data.lobby_code).emit('mission_updated', {
      startNode: data.startNode,
      targetNode: data.targetNode
    });

    console.log(`Misión actualizada en lobby: ${data.lobby_code}`);
    return { status: 'success' };
  }
}