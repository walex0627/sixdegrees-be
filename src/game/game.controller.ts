import { Controller, Get, Query } from '@nestjs/common';
import { GameService } from './game.service';

@Controller('game')
export class GameController {
    constructor(private readonly gameService: GameService) { }

    @Get('search')
    async search(
        @Query('q') query: string,
        @Query('type') type: 'person' | 'movie'
    ) {
        return this.gameService.searchEntity(query, type);
    }

    @Get('connections')
    async getConnections(
        @Query('contextId') contextId: string,
        @Query('contextType') contextType: 'person' | 'movie',
        @Query('q') query?: string
    ) {
        if (contextType === 'person') {
            return this.gameService.getMoviesByPerson(contextId, query);
        } else {
            return this.gameService.getPeopleByMovie(contextId, query);
        }
    }
}