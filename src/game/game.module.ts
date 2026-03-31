import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports:[
    HttpModule.register({
      baseURL: 'https://api.themoviedb.org/3',
      timeout:5000
    })
  ],
  providers: [GameGateway, GameService],
})
export class GameModule {}
