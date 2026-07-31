import { Rng } from '../../core/rng';
import { overallRating } from '../data/attributes';
import { DIVISION_BY_ID, nextDivision, type DivisionId } from '../data/leagues';
import type { LeaderboardEntry, SaveGame, TournamentState } from '../save/schema';
import { generateDivisionRoster, type RosterWrestler } from './roster';

export interface LeagueOpponentOption {
  wrestler: RosterWrestler;
  /** True when beating this one advances the promotion track. */
  ranked: boolean;
  alreadyBeaten: boolean;
  isPromotionBout: boolean;
  reward: { coins: number; xp: number };
}

/** The three opponents offered on the league screen. */
export const leagueSlate = (save: SaveGame): LeagueOpponentOption[] => {
  const div = DIVISION_BY_ID.get(save.league.division)!;
  const roster = generateDivisionRoster(save.league.division, save.league.seasonNumber);
  const beaten = new Set(save.league.defeated);
  const playerRating = overallRating(save.profile.attributes);

  // Sort by how close their rating is to the player's — good matchmaking.
  const sorted = [...roster].sort(
    (a, b) => Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating),
  );

  const promotion = save.league.promotionAvailable;
  const picks: RosterWrestler[] = [];

  if (promotion) {
    // Promotion bout: face the division's top-rated wrestler.
    picks.push([...roster].sort((a, b) => b.rating - a.rating)[0]);
  } else {
    const unbeaten = sorted.filter((w) => !beaten.has(w.id));
    const pool = unbeaten.length >= 3 ? unbeaten : sorted;
    picks.push(...pool.slice(0, 3));
  }

  return picks.map((w) => ({
    wrestler: w,
    ranked: true,
    alreadyBeaten: beaten.has(w.id),
    isPromotionBout: promotion,
    reward: {
      coins: Math.round(div.purse * (promotion ? 2.2 : 1) * (1 + (w.rating - playerRating) / 100)),
      xp: Math.round(160 * div.xpMultiplier * (promotion ? 1.8 : 1)),
    },
  }));
};

export interface LeagueUpdate {
  promoted: boolean;
  newDivision: DivisionId | null;
  promotionUnlocked: boolean;
  seasonEnded: boolean;
}

export const recordLeagueResult = (
  save: SaveGame,
  opponentId: string,
  won: boolean,
  leaguePoints: number,
  wasPromotionBout: boolean,
): LeagueUpdate => {
  const L = save.league;
  const div = DIVISION_BY_ID.get(L.division)!;
  L.points += leaguePoints;

  const out: LeagueUpdate = {
    promoted: false,
    newDivision: null,
    promotionUnlocked: false,
    seasonEnded: false,
  };

  if (won) {
    L.winsInDivision++;
    if (!L.defeated.includes(opponentId)) L.defeated.push(opponentId);
  } else {
    L.lossesInDivision++;
  }

  if (wasPromotionBout) {
    if (won) {
      const next = nextDivision(L.division);
      if (next) {
        L.division = next.id;
        L.winsInDivision = 0;
        L.lossesInDivision = 0;
        L.defeated = [];
        L.promotionAvailable = false;
        L.points = 0;
        out.promoted = true;
        out.newDivision = next.id;
      } else {
        // Already champion: winning the promotion bout wins the world title.
        if (!L.titlesHeld.includes('world:champion')) L.titlesHeld.push('world:champion');
        L.promotionAvailable = false;
        L.winsInDivision = 0;
      }
    } else {
      // Failed promotion — must re-earn it.
      L.promotionAvailable = false;
      L.winsInDivision = Math.max(0, div.winsToPromote - 1);
    }
    return out;
  }

  if (!L.promotionAvailable && L.winsInDivision >= div.winsToPromote) {
    L.promotionAvailable = true;
    out.promotionUnlocked = true;
  }

  return out;
};

export const buildLeaderboard = (save: SaveGame): LeaderboardEntry[] => {
  const roster = generateDivisionRoster(save.league.division, save.league.seasonNumber);
  const rng = Rng.fromString(`lb|${save.league.division}|${save.league.seasonNumber}`);

  const entries: LeaderboardEntry[] = roster.map((w) => ({
    id: w.id,
    name: w.name,
    clubId: w.clubId,
    // Simulated season results, deterministic per season.
    points: w.wins * 3 + rng.int(0, 6),
    wins: w.wins,
    losses: w.losses,
    rating: w.rating,
  }));

  entries.push({
    id: 'player',
    name: save.profile.name,
    clubId: save.profile.clubId,
    points: save.league.points,
    wins: save.league.winsInDivision,
    losses: save.league.lossesInDivision,
    rating: overallRating(save.profile.attributes),
    isPlayer: true,
  });

  entries.sort((a, b) => b.points - a.points || b.rating - a.rating);
  return entries;
};

// --------------------------------------------------------------- tournaments

export const createTournament = (
  save: SaveGame,
  name: string,
  size: 4 | 8 = 8,
): TournamentState => {
  const division = save.league.division;
  const seed = (Date.now() ^ (save.profile.level * 7919)) >>> 0;
  const rng = new Rng(seed);
  const roster = generateDivisionRoster(division, save.league.seasonNumber, Math.max(12, size * 2));
  const field = rng.shuffle([...roster]).slice(0, size - 1).map((w) => w.id);
  const participants = rng.shuffle(['player', ...field]);

  const div = DIVISION_BY_ID.get(division)!;
  return {
    id: `t_${seed.toString(36)}`,
    name,
    division,
    seed,
    bracket: [participants],
    roundIndex: 0,
    matchIndex: 0,
    eliminated: false,
    completed: false,
    prize: Math.round(div.purse * (size === 8 ? 6 : 3)),
  };
};

/** Which wrestler the player faces in the current tournament round. */
export const tournamentOpponent = (t: TournamentState): string | null => {
  const round = t.bracket[t.roundIndex];
  if (!round) return null;
  const idx = round.indexOf('player');
  if (idx < 0) return null;
  const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
  return round[pairIdx] ?? null;
};

export const advanceTournament = (
  t: TournamentState,
  playerWon: boolean,
  rngSeed = t.seed,
): { finished: boolean; championId: string | null } => {
  const rng = new Rng(rngSeed + t.roundIndex * 7717);
  const round = t.bracket[t.roundIndex];
  if (!round) return { finished: true, championId: null };

  const winners: string[] = [];
  for (let i = 0; i < round.length; i += 2) {
    const a = round[i];
    const b = round[i + 1];
    if (b === undefined) {
      winners.push(a);
      continue;
    }
    if (a === 'player' || b === 'player') {
      winners.push(playerWon ? 'player' : a === 'player' ? b : a);
    } else {
      winners.push(rng.chance(0.5) ? a : b);
    }
  }

  t.bracket.push(winners);
  t.roundIndex++;
  if (!playerWon) t.eliminated = true;

  if (winners.length === 1) {
    t.completed = true;
    return { finished: true, championId: winners[0] };
  }
  if (t.eliminated) {
    // Sim the rest so the bracket displays a champion.
    let cur = winners;
    let guard = 0;
    while (cur.length > 1 && guard++ < 6) {
      const nxt: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const a = cur[i];
        const b = cur[i + 1];
        nxt.push(b === undefined ? a : rng.chance(0.5) ? a : b);
      }
      t.bracket.push(nxt);
      cur = nxt;
    }
    t.completed = true;
    return { finished: true, championId: cur[0] };
  }
  return { finished: false, championId: null };
};

export const roundName = (remaining: number): string => {
  switch (remaining) {
    case 2:
      return 'Final';
    case 4:
      return 'Semi-Final';
    case 8:
      return 'Quarter-Final';
    case 16:
      return 'Round of 16';
    default:
      return `Round of ${remaining}`;
  }
};
