
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

  //Roast jokes
  getRoastMessage(connections: number): string {
    const roasts = [
      `¿${connections} pasos? Hasta el Snyder Cut es más corto que tu lógica.`,
      `Tardaste tanto que a la película ya le hicieron un remake live-action de Disney.`,
      `Tu conocimiento de cine es tan pobre que crees que 'Rápido y Furioso' merece un Oscar.`,
      `Ni con 3 horas de exposición Nolan explica por qué te tomó tanto conectar esto.`,
      `Esa cadena es más larga que la lista de ex-novias de Taylor Swift.`,
    ];
    return roasts[Math.floor(Math.random() * roasts.length)];
  }

  //Win message
  getWinMessage(steps: number): string {
  const winMessages = [
    `¡CINETO! 🎥 Coronaste en ${steps} pasos, estás pasado de niveles.`,
    `¡LA CABRAAAAA! 🐐 Metiste un combo que ni Westcol en un buen día.`,
    `¿${steps} pasos? Simplemente un diferente, un iluminado, un distinto.`,
    `¡QUÉ NIVEL DE IQ! Estás desperdiciado aquí, deberías ser el director de Marvel.`,
    `¡WEEEEST! Metiste la presión, eso fue cine puro. 🍿`,
    `Ni el algoritmo de YouTube tiene tanta precisión como tú. ¡Coronadísimo!`,
    `¡Puro Prime! Estás en tu mejor momento, no dejes que nadie te diga lo contrario.`,
    `Eso fue un 'clutch' histórico. Estás bendecido por el dios del streaming.`,
    `¡BOOM! Menos de 6 pasos... eres literalmente el protagonista de la película.`,
    `¡ESOOOO! Te ganaste el respeto de la comunidad, mi king.`
  ];
  return winMessages[Math.floor(Math.random() * winMessages.length)];
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
  
  // Limpiamos la data para que el Front no reciba basura
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