export const MASTER_WALLET_BASE = 1_250_000;
export const TOTAL_BOTS = 50_000;
export const CONCURRENT_BOTS = 500;
export const ACTIVE_WINDOW_MIN = 5;
export const ROTATION_CYCLE_HOURS = 8;
export const SWEEP_INTERVAL_HOURS = 6;
export const FACTION_LOSS_THRESHOLD = 0.04;
export const GLOBAL_LOSS_THRESHOLD = 0.05;

export const TOKENS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT'] as const;

export const TRADING_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'] as const;

export const SIGNAL_TYPES = ['buy', 'sell', 'arbitrage', 'liquidation', 'bridge', 'stake', 'unstake'] as const;

export interface FactionMeta {
  id: string;
  name: string;
  member: string;
  persona: string;
  color: string;
  iconName: string;
}

export const FACTIONS: FactionMeta[] = [
  { id: 'rza', name: 'The Abbot', member: 'RZA', persona: 'Supreme Architect — orchestrates all faction strategies', color: 'amber', iconName: 'Crown' },
  { id: 'gza', name: 'The Genius', member: 'GZA', persona: 'Lyrical Scientist — precision analytics and data-driven trades', color: 'blue', iconName: 'Brain' },
  { id: 'suicideboys', name: '$uicideboy$', member: '$crim & Ruby', persona: 'Predator faction — high-risk, high-magnitude strikes', color: 'slate', iconName: 'Skull' },
  { id: 'methodman', name: 'Meth Lab', member: 'Method Man', persona: 'Street Chemist — volatile short-term plays', color: 'red', iconName: 'Zap' },
  { id: 'ghostface', name: 'Tony Starks', member: 'Ghostface Killah', persona: 'Supreme Clientele — premium token selection', color: 'pink', iconName: 'Ghost' },
  { id: 'raekwon', name: 'The Chef', member: 'Raekwon', persona: 'Cuban Linx strategist — calculated mid-range plays', color: 'green', iconName: 'ChefHat' },
  { id: 'inspectah', name: 'Inspectah Deck', member: 'Inspectah Deck', persona: 'Hedge specialist — sentiment-inverted defense plays', color: 'purple', iconName: 'Shield' },
  { id: 'ugod', name: 'U-God', member: 'U-God', persona: 'Golden Arms — cross-chain bridge arbitrage', color: 'cyan', iconName: 'ArrowLeftRight' },
  { id: 'mastakilla', name: 'Masta Killa', member: 'Masta Killa', persona: 'No Said Date — patient long-hold accumulation', color: 'lime', iconName: 'Hourglass' },
];

export const MANAGERS = [
  { id: 'abbot', name: 'The Abbot (RZA + GZA)', role: 'Supreme Commander', trigger_type: 'heartbeat' },
  { id: 'meth-manager', name: 'Method Man', role: 'Operations Lead', trigger_type: 'signal_volume' },
  { id: 'rae-manager', name: 'Raekwon', role: 'Risk Manager', trigger_type: 'loss_threshold' },
  { id: 'ghost-manager', name: 'Ghostface', role: 'Revenue Officer', trigger_type: 'sweep_trigger' },
];
