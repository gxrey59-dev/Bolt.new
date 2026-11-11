export const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}USDT$/;
export const MAX_HISTORY_SYMBOLS = 40;

export function collectHistorySymbols(input: {
  tracked: string[];
  configured: string[];
  held: string[];
  openOrders: string[];
}): { symbols: string[]; omittedSymbols: string[] } {
  // Prioritize funds held now and outstanding exchange orders before old records.
  const symbols = [...new Set([
    ...input.openOrders,
    ...input.held.filter(asset => asset !== 'USDT').map(asset => `${asset}USDT`),
    ...input.configured,
    ...input.tracked,
  ].map(symbol => symbol.toUpperCase()).filter(symbol => SYMBOL_PATTERN.test(symbol)))];
  return { symbols: symbols.slice(0, MAX_HISTORY_SYMBOLS), omittedSymbols: symbols.slice(MAX_HISTORY_SYMBOLS) };
}

export async function mapInBatches<T, R>(values: T[], size: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += size) {
    results.push(...await Promise.all(values.slice(index, index + size).map(mapper)));
  }
  return results;
}
