import type { Attributes } from './attributes';

export type FightingStyle = 'power' | 'technical' | 'speed' | 'allround';

export interface StyleDef {
  id: FightingStyle;
  name: string;
  name_fa?: string;
  blurb: string;
  blurb_fa?: string;
  color: string;
  /** Multipliers applied to generated opponent attributes. */
  bias: Partial<Record<keyof Attributes, number>>;
  /** AI behaviour weights. */
  ai: {
    aggression: number;
    patience: number;
    /** Preference weight per move category. */
    prefer: Partial<Record<string, number>>;
    /** How strongly the AI adapts to the player's habits. */
    adaptivity: number;
    /** Willingness to spend stamina in a burst. */
    burst: number;
  };
}

export const STYLES: Record<FightingStyle, StyleDef> = {
  power: {
    id: 'power',
    name: 'Power Wrestler',
    name_fa: 'کشتی‌گیر قدرتی',
    blurb: 'Bullies the tie-up, hunts throws and ends matches with one big slam.',
    blurb_fa: 'درگیری را به زور می‌برد، دنبال پرتاب است و مسابقه را با یک کوبش بزرگ تمام می‌کند.',
    color: '#ff5d47',
    bias: { strength: 1.18, defense: 1.08, stamina: 0.94, speed: 0.86, technique: 0.92 },
    ai: {
      aggression: 0.78,
      patience: 0.35,
      prefer: { throw: 1.9, grapple: 1.5, strike: 1.0, takedown: 0.9, submission: 0.8 },
      adaptivity: 0.4,
      burst: 0.8,
    },
  },
  technical: {
    id: 'technical',
    name: 'Technical Wrestler',
    name_fa: 'کشتی‌گیر تکنیکی',
    blurb: 'Chain wrestling machine. Punishes every mistake with a reversal.',
    blurb_fa: 'ماشین کشتی زنجیره‌ای. هر اشتباه را با یک برگشت جریمه می‌کند.',
    color: '#c084fc',
    bias: { technique: 1.2, defense: 1.1, stamina: 1.04, strength: 0.9, speed: 0.95 },
    ai: {
      aggression: 0.5,
      patience: 0.8,
      prefer: { submission: 1.9, takedown: 1.3, grapple: 1.2, throw: 1.0, strike: 0.7 },
      adaptivity: 0.85,
      burst: 0.45,
    },
  },
  speed: {
    id: 'speed',
    name: 'Speed Wrestler',
    name_fa: 'کشتی‌گیر سرعتی',
    blurb: 'Never stops moving. Blitz shots, scrambles and steals points late.',
    blurb_fa: 'هرگز از حرکت نمی‌ایستد. ورک‌های برق‌آسا، درگیری‌های آشفته و دزدیدن امتیاز در دقایق پایانی.',
    color: '#38bdf8',
    bias: { speed: 1.22, stamina: 1.1, technique: 1.02, strength: 0.84, defense: 0.9 },
    ai: {
      aggression: 0.85,
      patience: 0.3,
      prefer: { takedown: 1.9, strike: 1.5, grapple: 1.0, submission: 0.9, throw: 0.6 },
      adaptivity: 0.6,
      burst: 0.65,
    },
  },
  allround: {
    id: 'allround',
    name: 'All-Rounder',
    name_fa: 'همه‌فن‌حریف',
    blurb: 'No holes in the game. Reads the match and picks you apart.',
    blurb_fa: 'هیچ حفره‌ای در بازی‌اش نیست. مسابقه را می‌خواند و تکه‌تکه‌ات می‌کند.',
    color: '#4ade80',
    bias: { strength: 1.0, stamina: 1.05, speed: 1.0, technique: 1.05, defense: 1.02 },
    ai: {
      aggression: 0.62,
      patience: 0.6,
      prefer: { takedown: 1.2, grapple: 1.2, throw: 1.1, submission: 1.1, strike: 1.0 },
      adaptivity: 0.7,
      burst: 0.6,
    },
  },
};

export const STYLE_LIST = Object.values(STYLES);
