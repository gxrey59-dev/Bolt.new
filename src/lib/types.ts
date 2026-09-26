export interface Faction {
  id: string;
  name: string;
  member_name: string;
  persona: string;
  bot_count: number;
  allocated_capital: number;
  reserve_capital: number;
  active_capital: number;
  profit_today: number;
  profit_total: number;
  loss_today: number;
  trades_today: number;
  win_rate: number;
  consecutive_losses: number;
  status: 'active' | 'paused' | 'halted' | 'cooldown';
  paused_until: string | null;
  cooldown_until: string | null;
  gas_threshold: number;
  slippage_threshold: number;
  profit_target_48h: number;
  hold_hours: number;
  created_at: string;
  updated_at: string;
  paper_balance: number;
  open_positions: number;
}

export interface Manager {
  id: string;
  name: string;
  role: string;
  trigger_type: string;
  status: 'active' | 'degraded' | 'failover';
  health_score: number;
  last_heartbeat: string;
  temp_manager_bot_id: string | null;
  promoted_at: string | null;
  created_at: string;
}

export interface Signal {
  id: string;
  batch_id: string;
  faction_id: string;
  signal_type: 'buy' | 'sell' | 'arbitrage' | 'liquidation' | 'bridge' | 'stake' | 'unstake';
  token_symbol: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'routed' | 'executed' | 'failed';
  latency_ms: number;
  idempotency_key: string;
  created_at: string;
}

export interface Sweep {
  id: string;
  sweep_type: 'cream' | 'rebalance';
  amount_swept: number;
  bots_swept: number;
  rebalanced_amount: number;
  master_wallet_balance: number;
  status: 'completed' | 'partial' | 'failed';
  idempotency_key: string;
  created_at: string;
}

export interface CircuitBreaker {
  id: string;
  scope: 'faction' | 'global';
  faction_id: string | null;
  trigger_type: string;
  loss_percent: number;
  threshold: number;
  time_window: string;
  action_taken: string;
  resolved: boolean;
  created_at: string;
}

export interface Sentiment {
  id: string;
  mode: 'bullish' | 'bearish' | 'neutral';
  label: string;
  triggered_by: string;
  active: boolean;
  created_at: string;
}

export interface StressTest {
  id: string;
  label: string;
  signals_routed: number;
  duration_seconds: number;
  breakers_triggered: number;
  sweeps_executed: number;
  peak_latency_ms: number;
  status: 'running' | 'completed' | 'failed';
  created_at: string;
}

export interface RotationBatch {
  id: string;
  batch_number: number;
  active_bots: number;
  total_bots: number;
  faction_id: string;
  window_start: string;
  window_end: string;
  status: 'active' | 'expired' | 'pending';
  created_at: string;
}

export interface AuditEntry {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CollectionConfig {
  id: number;
  destination_address: string;
  token: string;
  network: string;
  min_threshold: number;
  armed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Collection {
  id: string;
  config_id: number;
  amount: number;
  token: string;
  destination_address: string;
  network: string;
  status: 'pending' | 'confirmed' | 'completed' | 'failed';
  tx_hash: string | null;
  error_message: string | null;
  idempotency_key: string;
  confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CollectionRoute {
  id: string;
  withdrawal_id: string;
  strategy: string;
  ai_model: string;
  ai_reasoning: string;
  endpoints_tried: string[];
  endpoint_results: { endpoint: string; status: number; error: string | null }[];
  chosen_endpoint: string | null;
  rapidapi_used: boolean;
  latency_ms: number;
  success: boolean;
  created_at: string;
}

export interface PaperTrade {
  id: string;
  faction_id: string;
  symbol: string;
  side: 'long' | 'short';
  strategy: string;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  position_value: number;
  pnl: number;
  status: 'open' | 'closed';
  stop_loss: number;
  take_profit: number;
  reasoning: string;
  indicators_snapshot: Record<string, unknown>;
  opened_at: string;
  closed_at: string | null;
}

export interface OpenPosition extends PaperTrade {
  current_price: number;
  unrealized_pnl: number;
  pnl_pct: number;
  is_live?: boolean;
  binance_order_id?: string | null;
}

export interface StrategyConfig {
  id: number;
  paper_mode: boolean;
  starting_capital: number;
  max_position_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  rsi_oversold: number;
  rsi_overbought: number;
  macd_threshold: number;
  momentum_lookback: number;
  mean_reversion_bands: number;
  active_strategies: string[];
  updated_at: string;
}

export type TabId = 'command' | 'dashboard' | 'table' | 'operations' | 'live';
