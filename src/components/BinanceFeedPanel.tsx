import { useState, useEffect } from 'react';
import { Coins, RefreshCw, Play, Brain } from 'lucide-react';
import { fetchLivePrices, runStrategyScan } from '@/lib/engine';

interface TickerData {
  symbol: string;
  price: number;
  change: number;
  volume: number;
  high: number;
  low: number;
}

export default function BinanceFeedPanel() {
  const [prices, setPrices] = useState<TickerData[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPrices = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLivePrices();
      setPrices(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch prices');
    } finally {
      setLoading(false);
    }
  };

  const runScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await runStrategyScan();
      if (result) {
        setScanResult(`Found ${result.signals} signals, opened ${result.tradesOpened} paper trades, closed ${result.tradesClosed} positions`);
      } else {
        setScanResult('Scan failed — check connection');
      }
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <Coins className="h-5 w-5 text-amber-400" />
        <h2 className="text-base font-semibold text-zinc-200">Binance Live Market Data</h2>
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          LIVE
        </span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="mb-4 flex gap-2">
          <button
            onClick={fetchPrices}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Prices
          </button>
          <button
            onClick={runScan}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            <Brain className="h-3.5 w-3.5" />
            {scanning ? 'Scanning...' : 'Run Strategy Scan'}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {scanResult && (
          <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-400">
            {scanResult}
          </div>
        )}

        {prices.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {prices.map(p => (
              <div
                key={p.symbol}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 transition-colors hover:border-zinc-700"
              >
                <p className="mb-1 text-[11px] font-semibold text-zinc-400">
                  {p.symbol.replace('USDT', '')}
                </p>
                <p className="font-mono text-sm font-bold tabular-nums text-zinc-200">
                  ${p.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </p>
                <p className={`font-mono text-xs tabular-nums ${p.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {p.change >= 0 ? '+' : ''}{p.change.toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
        ) : !loading && !error ? (
          <p className="text-center text-xs text-zinc-600 py-4">No price data available</p>
        ) : null}
      </div>
    </section>
  );
}
