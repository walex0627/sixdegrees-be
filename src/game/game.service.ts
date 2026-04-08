
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GameService {
  constructor(private readonly httpService: HttpService) { }

  // Helper para evitar Rate Limiting de TMDB con cadenas largas
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  // Devuelve peliculas donde ha participado una persona (para busqueda contextual)
  async getMoviesByPerson(personId: string, query?: string): Promise<any[]> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/person/${personId}/movie_credits?api_key=${TMDB_API_KEY}`;
    const { data } = await firstValueFrom(this.httpService.get(url));

    // Combinar cast + directores del crew
    const movies = [
      ...data.cast,
      ...data.crew.filter((c: any) => c.job === 'Director')
    ];

    // Deduplicar por ID
    const unique = Array.from(new Map(movies.map((m: any) => [m.id, m])).values()) as any[];

    // Filtrar por texto si se provee
    const filtered = query
      ? unique.filter((m: any) => m.title?.toLowerCase().includes(query.toLowerCase()))
      : unique;

    return filtered.slice(0, 10).map((m: any) => ({
      id: m.id.toString(),
      name: m.title,
      type: 'movie',
      image: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null
    }));
  }

  // Devuelve el cast de una pelicula (para busqueda contextual)
  async getPeopleByMovie(movieId: string, query?: string): Promise<any[]> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`;
    const { data } = await firstValueFrom(this.httpService.get(url));

    const people = [
      ...data.cast,
      ...data.crew.filter((c: any) => c.job === 'Director')
    ];

    const filtered = query
      ? people.filter((p: any) => p.name?.toLowerCase().includes(query.toLowerCase()))
      : people;

    return filtered.slice(0, 10).map((p: any) => ({
      id: p.id.toString(),
      name: p.name,
      type: 'person',
      image: p.profile_path ? `https://image.tmdb.org/t/p/w200${p.profile_path}` : null
    }));
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
getRoastMessage(steps: number): string {
  const roasts = [
    `¿${steps} pasos? Esa cadena es más larga que los créditos de una de Marvel.`,
    `Tardaste tanto (${steps} pasos) que a la película ya le hicieron un remake live-action.`,
    `Tu lógica de ${steps} pasos es más confusa que el final de Inception.`,
    `Ni con 3 horas de exposición Nolan explica por qué te tomó ${steps} pasos conectar esto.`,
    `Esa cadena de ${steps} pasos es más larga que la fila para ver el estreno de Avengers.`,
  ];
  return roasts[Math.floor(Math.random() * roasts.length)];
}

//Validate if the movie is valid
async validateFullChain(chain: { id: string, type: 'person' | 'movie' }[]): Promise<boolean> {
  // Una cadena mínima válida es: Actor -> Película -> Actor (3 nodos)
  if (chain.length < 2) return false;

  try {
    for (let i = 0; i < chain.length - 1; i++) {
      const current = chain[i];
      const next = chain[i + 1];

      // No pueden haber dos tipos seguidos (Actor -> Actor es error)
      if (current.type === next.type) return false;

      // Pausa entre llamadas para evitar Rate Limiting 429 de TMDB
      // Solo aplicamos delay a partir del 3er par (cadenas largas > 4 nodos)
      if (i >= 2) {
        await this.delay(300);
      }

      // Si es Persona -> Película
      if (current.type === 'person' && next.type === 'movie') {
        const isValid = await this.verifyCredit(current.id.toString(), next.id.toString());
        if (!isValid) return false;
      }

      // Si es Película -> Persona
      if (current.type === 'movie' && next.type === 'person') {
        const isValid = await this.verifyCredit(next.id.toString(), current.id.toString());
        if (!isValid) return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error crítico validando cadena completa:', error.message);
    throw new Error('TMDB_VALIDATION_ERROR');
  }
}
}