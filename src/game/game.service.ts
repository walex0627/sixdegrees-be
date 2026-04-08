
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GameService {
  constructor(private readonly httpService: HttpService) { }

  // Helper to introduce a delay between API calls and avoid TMDB rate limiting
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Verifies whether a person (actor or director) has a credit in a given movie.
   * Checks both the cast list and the directing crew.
   */
  async verifyCredit(personID: string, movieID: string): Promise<Boolean> {
    try {
      const TMDB_API_KEY = process.env.TMDB_API_KEY;
      const url = `https://api.themoviedb.org/3/movie/${movieID}/credits?api_key=${TMDB_API_KEY}`;

      const { data } = await firstValueFrom(
        this.httpService.get(url)
      );

      // Check both cast and directing crew entries
      const isInCast = data.cast.some(p => p.id.toString() === personID);
      const isInCrew = data.crew.some(p => p.id.toString() === personID && p.job === 'Director');

      return isInCast || isInCrew;
    } catch (error) {
      console.error('Error verifying credit on TMDB:', error.message);
      return false;
    }
  }

  /**
   * Free-text search for a person or movie across all of TMDB.
   * Used during lobby setup to select the start and target nodes.
   */
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

  /**
   * Returns movies in which a specific person has participated (cast or director).
   * Used for contextual in-game search: after selecting a person node, the player
   * can only pick from that person's filmography.
   * Optionally filters results by a search query string.
   */
  async getMoviesByPerson(personId: string, query?: string): Promise<any[]> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/person/${personId}/movie_credits?api_key=${TMDB_API_KEY}`;
    const { data } = await firstValueFrom(this.httpService.get(url));

    // Merge acting credits with directing credits
    const movies = [
      ...data.cast,
      ...data.crew.filter((c: any) => c.job === 'Director')
    ];

    // Deduplicate by movie ID
    const unique = Array.from(new Map(movies.map((m: any) => [m.id, m])).values()) as any[];

    // Apply optional text filter
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

  /**
   * Returns the cast and director of a specific movie.
   * Used for contextual in-game search: after selecting a movie node, the player
   * can only pick from that movie's credited cast and crew.
   * Optionally filters results by a search query string.
   */
  async getPeopleByMovie(movieId: string, query?: string): Promise<any[]> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`;
    const { data } = await firstValueFrom(this.httpService.get(url));

    // Merge cast list with the director from crew
    const people = [
      ...data.cast,
      ...data.crew.filter((c: any) => c.job === 'Director')
    ];

    // Apply optional text filter
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

  /**
   * Returns a randomised win message based on how many steps it took to complete the chain.
   * Shorter chains produce more glowing praise.
   */
  getWinMessage(steps: number): string {
    const winMessages = [
      `CINETO! 🎥 You nailed it in just ${steps} ${steps === 1 ? 'step' : 'steps'} — you're on a different level.`,
      `GOAT BEHAVIOUR! 🐐 ${steps === 1 ? 'One single move!' : `In ${steps} steps`} — that was a lethal combo.`,
      `${steps} ${steps === 1 ? 'step' : 'steps'}? Simply enlightened. Simply elite.`,
      `WHAT AN IQ! With ${steps} steps you could already be directing Marvel Phase 6.`,
      `BOOM! ${steps} steps was all it took to prove who runs this show. 🍿`,
      `Pure class! ${steps} steps were enough to show who's in charge here.`,
      `BOOM! Only ${steps} steps... you are literally the protagonist of this film.`,
    ];
    return winMessages[Math.floor(Math.random() * winMessages.length)];
  }

  /**
   * Returns a randomised roast message for chains that exceed 6 steps.
   */
  getRoastMessage(steps: number): string {
    const roasts = [
      `${steps} steps? That chain is longer than the credits on a Marvel film.`,
      `You took so long (${steps} steps) they already made a live-action remake of the movie.`,
      `Your ${steps}-step logic is more confusing than the ending of Inception.`,
      `Not even 3 hours of Nolan exposition explains why it took you ${steps} steps to connect these.`,
      `That ${steps}-step chain is longer than the queue for an Avengers opening night.`,
    ];
    return roasts[Math.floor(Math.random() * roasts.length)];
  }

  /**
   * Validates an entire submitted chain by verifying each consecutive person–movie
   * or movie–person pair against the TMDB credits API.
   *
   * A valid chain must alternate between person and movie nodes.
   * A 300ms delay is applied from the 3rd pair onwards to respect TMDB rate limits.
   */
  async validateFullChain(chain: { id: string, type: 'person' | 'movie' }[]): Promise<boolean> {
    // A valid chain requires at least 2 nodes
    if (chain.length < 2) return false;

    try {
      for (let i = 0; i < chain.length - 1; i++) {
        const current = chain[i];
        const next = chain[i + 1];

        // Two consecutive nodes of the same type are always invalid
        if (current.type === next.type) return false;

        // Apply a throttle delay from the 3rd pair onwards (chains longer than 4 nodes)
        // to avoid TMDB rate limiting (HTTP 429)
        if (i >= 2) {
          await this.delay(300);
        }

        // Validate a person → movie link
        if (current.type === 'person' && next.type === 'movie') {
          const isValid = await this.verifyCredit(current.id.toString(), next.id.toString());
          if (!isValid) return false;
        }

        // Validate a movie → person link
        if (current.type === 'movie' && next.type === 'person') {
          const isValid = await this.verifyCredit(next.id.toString(), current.id.toString());
          if (!isValid) return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Critical error validating full chain:', error.message);
      throw new Error('TMDB_VALIDATION_ERROR');
    }
  }
}