
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GameService {
  constructor(private readonly httpService: HttpService) { }

  //This validate if the actor is in the movie credits
  async verifyCredit(personID: string, movieID: string): Promise<Boolean> {
    
    try {
      const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/movie/${movieID}/credits?api_key=${TMDB_API_KEY}`;

    const { data } = await firstValueFrom(
      this.httpService.get(url)
    );

    //Search actors in cast and crew
    const isInCast = data.cast.some(p => p.id.toString() === personID)
    const isInCrew = data.crew.some(p => p.id.toString() === personID && p.job === 'Director')

    return isInCast || isInCrew
    } catch (error) {
      console.error('Error validando en TMDB:', error.message);
      return false;
    }
    
  }

// Win message
getWinMessage(steps: number): string {
  const winMessages = [
    `¡CINETO! 🎥 Coronaste en solo ${steps} ${steps === 1 ? 'paso' : 'pasos'}, estás en otro nivel.`,
    `¡LA CABRAAAAA! 🐐 ${steps === 1 ? '¡Un solo movimiento!' : `En ${steps} pasos`} metiste un combo mortal.`,
    `¿${steps} ${steps === 1 ? 'pasito' : 'pasos'}? Simplemente un iluminado, un distinto.`,
    `¡QUÉ NIVEL DE IQ! Con ${steps} pasos ya podrías dirigir la fase 6 de Marvel.`,
    `¡WEEEEST! Metiste la presión en ${steps} pasos, eso fue cine puro. 🍿`,
    `¡Puro Prime! ${steps} pasos bastaron para demostrar quién manda aquí.`,
    `¡BOOM! Solo ${steps} pasos... eres literalmente el protagonista de la película.`,
  ];
  return winMessages[Math.floor(Math.random() * winMessages.length)];
}

// Roast jokes
getRoastMessage(connections: number): string {
  const roasts = [
    `¿${connections} pasos? Esa cadena es más larga que los créditos de una de Marvel.`,
    `Tardaste tanto (${connections} pasos) que a la película ya le hicieron un remake live-action.`,
    `Tu lógica de ${connections} pasos es más confusa que el final de Inception.`,
    `Ni con 3 horas de exposición Nolan explica por qué te tomó ${connections} pasos conectar esto.`,
    `Esa cadena de ${connections} pasos es más larga que la fila para ver el estreno de Avengers.`,
  ];
  return roasts[Math.floor(Math.random() * roasts.length)];
}

//Validate if the movie is valid
async validateFullChain(chain: { id: string, type: 'person' | 'movie' }[]): Promise<boolean> {
  if (chain.length < 3) return false;

  for (let i = 0; i < chain.length - 1; i++) {
    const current = chain[i];
    const next = chain[i + 1];
    if (current.type === next.type) return false; 

    if (current.type === 'person' && next.type === 'movie') {
      const isValid = await this.verifyCredit(current.id, next.id);
      if (!isValid) return false;
    }
    
    if (current.type === 'movie' && next.type === 'person') {
      const isValid = await this.verifyCredit(next.id, current.id);
      if (!isValid) return false;
    }
  }

  return true;
}
async searchEntity(query: string, type: 'person' | 'movie') {
  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
  
  const { data } = await firstValueFrom(this.httpService.get(url));
  
  return data.results.slice(0, 5).map(item => ({
    id: item.id.toString(),
    name: item.title || item.name,
    type: type,
    image: item.poster_path || item.profile_path 
      ? `https://image.tmdb.org/t/p/w200${item.poster_path || item.profile_path}`
      : null
  }));
}
}