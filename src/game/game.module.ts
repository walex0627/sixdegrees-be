import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { HttpModule } from '@nestjs/axios';
import { GameController } from './game.controller';

@Module({
  imports:[
    HttpModule.register({
      baseURL: 'https://api.themoviedb.org/3',
      timeout:5000
    })
  ],
  controllers: [GameController],
  providers: [GameGateway, GameService],
})
export class GameModule {}
