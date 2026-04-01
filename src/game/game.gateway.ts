import { WebSocketGateway, SubscribeMessage, MessageBody, ConnectedSocket, WebSocketServer } from '@nestjs/websockets';
import { GameService } from './game.service';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';

@WebSocketGateway({cors: {origin: '*'}})
export class GameGateway {
  constructor(private readonly gameService: GameService) {}

  @WebSocketServer() server:Server;
  private redis = new Redis(process.env.REDIS_URL || 'redis://default:xzdDpLxGBOCoatlEIOjCNtLZRZcYedzp@redis.railway.internal:6379',{
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000
  })

  @SubscribeMessage('create_lobby')
  async handleCreateLobbby(@ConnectedSocket() cliente:Socket){
    const lobbyCode = Math.random().toString(10).substring(2,8).toUpperCase();

    //Save the lobby in redis with a timer of 5 min
    await this.redis.hset(`lobby: ${lobbyCode}`, 'status', 'waiting')
    await this.redis.expire(`lobby: ${lobbyCode}`, 300 )

    cliente.join.apply(lobbyCode)
    return { event: 'lobby_created', lobbyCode }
  }

  @SubscribeMessage('join_lobby')
  async handleJoinLobby(
    @MessageBody() data:{ code:string, username:string},
    @ConnectedSocket() client: Socket
  ){
    const lobbbyExists = await this.redis.exists(`lobby: ${data.code}`)
    if (lobbbyExists){
      (client as any).username = data.username
      client.join(data.code)

      //Add player to redis set and rankin with 0 points
      await this.redis.sadd(`Lobby: ${data.code}:players`, data.username)
      await this.redis.zadd(`Lobby: ${data.code}:scores`, 0 , data.username)

      //Notify all players in the lobby
      this.server.to(data.code).emit('player_joined',{
        username:data.username,
        players: await this.redis.scard(`lobby: ${data.code}:players`)
      });

      return {status: 'success'}
    } else{
      return {status: 'error', message: 'lobby no encontrado'}
    }
  }

@SubscribeMessage('submit_chain')
  async handleChain(
    @MessageBody() data: { lobby: string; chain: { id: string; type: 'person' | 'movie' }[] },
    @ConnectedSocket() client: Socket,
  ) {
    // 1. Identify the user from the socket session
    const username = (client as any).username;
    if (!username) return { status: 'error', message: 'User not identified' };

    // 2. Validate the chain integrity using TMDB API through the GameService
    const isChainValid = await this.gameService.validateFullChain(data.chain);

    if (!isChainValid) {
      // If the chain is fake or broken, notify the lobby with 0 points
      return this.server.to(data.lobby).emit('round_result', {
        username,
        score: 0,
        message: "Nice try, cheater! That connection doesn't exist in this universe.",
      });
    }

    // 3. Calculate steps (Counting only movies as connection points)
    const steps = data.chain.filter((item) => item.type === 'movie').length;
    let finalScore = 0;
    let message = '';

    // 4. Scoring logic based on the "6 Degrees" rule
    if (steps <= 6) {
      // Bonus points for efficiency (The "GOAT" status)
      finalScore = 100 + (6 - steps) * 20;
      message = this.gameService.getWinMessage(steps);
    } else {
      // Minimum points for exceeding the limit (The "Roast" status)
      finalScore = 10;
      message = this.gameService.getRoastMessage(steps);
    }

    // 5. Update the ranking in Redis (Sorted Set)
    // Note: Removed the space in the Redis key string interpolation
    await this.redis.zincrby(`lobby:${data.lobby}:scores`, finalScore, username);

    // 6. Broadcast the results to all players in the lobby
    this.server.to(data.lobby).emit('round_result', {
      username,
      score: finalScore,
      message,
    });
  }
}
