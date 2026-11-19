// The token radar's model, v3 (radar-3): one snapshot of the protocol universe in, one
// ranked board out.
//
// radar-3 changes the value model itself, not the gate's shape. The board still covers
// every slug on the snapshot's watchlist (the floor, never a ceiling) and adds pre-token
// protocols below the floor by TVL, and it still ranks by EXPECTED value = FDV-implied
// value x launch probability. What changes is where every number comes from:
//
// 1. Self-calibrated multiples. radar-2 priced each category group at a multiple its
//    author picked by hand. radar-3 calibrates the multiple from the snapshot itself:
//    for each category group it takes the live-token protocols in that group, finds the
//    median of market-cap / TVL, and multiplies it by a documented FDV uplift (2.5x:
//    a token's fully diluted value runs well above its circulating market cap). The
//    result is clamped to [0.10, 0.60] and a group with fewer than five live comps
//    falls back to 0.25. No multiple is a hand-picked constant any more, and the
//    dashboard prints the calibration table so a reader can check it.
// 2. Spike-damped momentum. A seven-day TVL jump of +4,448% is a one-off inflow, not
//    a trend: radar-2 capped growth at +120% and still let the spike pay in full.
//    radar-3 damps growth with 1 / (1 + |g| / 150), so the reward for a spike flattens
//    out, and a spike above 100% in either direction costs 0.05 of launch probability
//    as reversion risk.
// 3. A maturity curve that peaks and decays. A protocol that has run four years with
//    no token is worth less than the same protocol at eighteen months: the sweet spot
//    is proven but still young. The maturity multiplier rises to 1.0 at one year, holds
//    to 900 days, then decays to 0.7 by 2,000 days instead of climbing forever.
// 4. Chain diversity with diminishing returns. The first extra chains matter most:
//    the chain multiplier is 1 + 0.06 * log2(chains), capped at 1.20, instead of a
//    flat 2% a chain.
// 5. A category base rate for launch probability. The snapshot itself says how often
//    protocols in each group already have a token; the model moves probability toward
//    that base rate, so a group where tokens are rare scores lower than one where
//    they are the norm. Every row carries its three top drivers, so the ranking can
//    be checked row by row.
//
//   multiple(group) = clamp(median(mcap / TVL over live comps in group) x 2.5, 0.10, 0.60)
//   fdv_implied     = tvl_usd x multiple x growthMult x maturityMult x chainMult
//   probability      = clamp(ageBand + baseRateAdj + growthAdj + spikeAdj + chainAdj, 0.12, 0.90)
//   expected         = round(fdv_implied x probability)
//   implied_value_usd (the ranked value) = expected
//
// No protocol name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category group: its calibrated multiple and its token base rate, both from the snapshot. */
export interface CategoryGroup {
  multiple: number;
  token_share: number;
  live_comps: number;
  median_mcap_tvl: number;
  label: string;
}

/** The model's constants: the calibration's fixed knobs, printed by the dashboard. */
export interface ModelConstants {
  fdv_uplift: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comps: number;
  fallback_multiple: number;
  growth_damping: number;
  growth_cap: number;
  growth_floor: number;
  spike_threshold: number;
  spike_penalty: number;
  maturity_floor: number;
  maturity_peak_days: number;
  maturity_hold_days: number;
  maturity_decay_days: number;
  maturity_decay_floor: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  category_groups: Record<string, CategoryGroup>;
}

/** The six category groups, with the label each one is shown under. */
export const GROUP_LABELS: Record<string, string> = {
  vaults: 'Vaults, curators & allocators',
  lending: 'Lending & credit',
  trading: 'Trading venues & yield',
  other: 'Other',
  rwa: 'RWA & stablecoins',
  infra: 'Bridges, staking & infra',
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  /** The ranked value: expected value = fdv_implied x launch probability. */
  implied_value_usd: number;
  /** The FDV-implied value before the launch probability is applied. */
  fdv_implied_usd: number;
  /** Expected value, identical to implied_value_usd, spelled out for the reader. */
  expected_value_usd: number;
  /** The model's launch probability, 0.12 to 0.90. */
  launch_probability: number;
  /** The three strongest drivers of this row's score, in plain words. */
  drivers: string[];
  model: {
    base_multiple: number;
    category_group: string;
    calibrated_from: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    launch_probability: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fdv_implied_usd: number;
  launch_probability: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  drivers: string[];
  /** The board's own seven farm steps, carried verbatim so page and board agree. */
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol's category group, from its DefiLlama category only. Never from its name. */
export function categoryGroup(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (
    c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator') ||
    c.includes('liquidity manager') || c.includes('collateral market') || c.includes('collateral management')
  ) return 'vaults';
  if (
    c.includes('lend') || c.includes('cdp') || c.includes('uncollateralized') ||
    c.includes('basis trading')
  ) return 'lending';
  if (
    c.includes('dex') || c.includes('derivative') || c.includes('yield') ||
    c.includes('leveraged farm') || c.includes('prediction') || c.includes('options') ||
    c.includes('synthetic') || c.includes('indexes') || c === 'farm'
  ) return 'trading';
  if (
    c.includes('rwa') || c.includes('stablecoin') || c.includes('algo-stables') ||
    c.includes('reserve currency')
  ) return 'rwa';
  if (
    c.includes('bridge') || c.includes('staking') || c.includes('restak') ||
    c.includes('chain') || c.includes('anchor btc') || c.includes('decentralized btc')
  ) return 'infra';
  return 'other';
}

/** The calibration's fixed knobs: the only numbers in radar-3 that are not read from the snapshot. */
export const CALIBRATION = {
  fdv_uplift: 2.5,
  multiple_floor: 0.1,
  multiple_cap: 0.6,
  min_comps: 5,
  fallback_multiple: 0.25,
  growth_damping: 150,
  growth_cap: 300,
  growth_floor: -60,
  spike_threshold: 100,
  spike_penalty: 0.05,
  maturity_floor: 0.6,
  maturity_peak_days: 365,
  maturity_hold_days: 900,
  maturity_decay_days: 2000,
  maturity_decay_floor: 0.7,
  unknown_age_days: 365,
  chain_step: 0.06,
  chain_cap: 1.2,
} as const;

/**
 * Calibrate every category group from the snapshot itself: the median market-cap /
 * TVL of its live-token protocols, times the FDV uplift, clamped; and the share of
 * its protocols that already have a token. Deterministic: medians of sorted lists.
 */
export function calibrate(snapshot: Snapshot): ModelConstants {
  const ratios: Record<string, number[]> = {};
  const totals: Record<string, number> = {};
  const withToken: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    const g = categoryGroup(p.category);
    totals[g] = (totals[g] ?? 0) + 1;
    if (p.mcap_usd !== null) {
      withToken[g] = (withToken[g] ?? 0) + 1;
      if (p.tvl_usd > 0) {
        (ratios[g] ??= []).push(p.mcap_usd / p.tvl_usd);
      }
    }
  }
  const groups: Record<string, CategoryGroup> = {};
  for (const [key, label] of Object.entries(GROUP_LABELS)) {
    const comps = (ratios[key] ?? []).sort((a, b) => a - b);
    const med = median(comps);
    const multiple =
      med === null || comps.length < CALIBRATION.min_comps
        ? CALIBRATION.fallback_multiple
        : Math.min(CALIBRATION.multiple_cap, Math.max(CALIBRATION.multiple_floor, med * CALIBRATION.fdv_uplift));
    groups[key] = {
      multiple: Math.round(multiple * 1000) / 1000,
      token_share: totals[key] ? Math.round(((withToken[key] ?? 0) / totals[key]!) * 1000) / 1000 : 0,
      live_comps: comps.length,
      median_mcap_tvl: med === null ? 0 : Math.round(med * 10000) / 10000,
      label,
    };
  }
  return {
    fdv_uplift: CALIBRATION.fdv_uplift,
    multiple_floor: CALIBRATION.multiple_floor,
    multiple_cap: CALIBRATION.multiple_cap,
    min_comps: CALIBRATION.min_comps,
    fallback_multiple: CALIBRATION.fallback_multiple,
    growth_damping: CALIBRATION.growth_damping,
    growth_cap: CALIBRATION.growth_cap,
    growth_floor: CALIBRATION.growth_floor,
    spike_threshold: CALIBRATION.spike_threshold,
    spike_penalty: CALIBRATION.spike_penalty,
    maturity_floor: CALIBRATION.maturity_floor,
    maturity_peak_days: CALIBRATION.maturity_peak_days,
    maturity_hold_days: CALIBRATION.maturity_hold_days,
    maturity_decay_days: CALIBRATION.maturity_decay_days,
    maturity_decay_floor: CALIBRATION.maturity_decay_floor,
    unknown_age_days: CALIBRATION.unknown_age_days,
    chain_step: CALIBRATION.chain_step,
    chain_cap: CALIBRATION.chain_cap,
    category_groups: groups,
  };
}

/** The launch-probability age band: the sweet spot is proven but not yet old. */
export function ageBand(age: number | null): number {
  if (age === null) return 0.45;
  if (age < 90) return 0.35;
  if (age < 180) return 0.55;
  if (age <= 900) return 0.78;
  if (age <= 1500) return 0.55;
  return 0.32;
}

/** The maturity multiplier: rises to full at one year, holds to 900 days, then decays. */
export function maturityMultiplier(age: number | null): number {
  const a = age ?? CALIBRATION.unknown_age_days;
  let f: number;
  if (a <= CALIBRATION.maturity_peak_days) f = a / CALIBRATION.maturity_peak_days;
  else if (a <= CALIBRATION.maturity_hold_days) f = 1;
  else if (a >= CALIBRATION.maturity_decay_days) f = CALIBRATION.maturity_decay_floor;
  else {
    f = 1 - (1 - CALIBRATION.maturity_decay_floor) * ((a - CALIBRATION.maturity_hold_days) / (CALIBRATION.maturity_decay_days - CALIBRATION.maturity_hold_days));
  }
  return CALIBRATION.maturity_floor + (1 - CALIBRATION.maturity_floor) * f;
}

/** The spike-damped growth multiplier: a jump's reward flattens as it grows. */
export function growthMultiplier(growthPct: number): number {
  const g = Math.min(CALIBRATION.growth_cap, Math.max(CALIBRATION.growth_floor, growthPct));
  return 1 + 0.5 * (g / 100) / (1 + Math.abs(g) / CALIBRATION.growth_damping);
}

/** The chain multiplier: the first extra chains matter most, capped at 1.20. */
export function chainMultiplier(chainCount: number): number {
  return Math.min(CALIBRATION.chain_cap, 1 + CALIBRATION.chain_step * Math.log2(Math.max(1, chainCount)));
}

export interface ScoredValue {
  fdv: number;
  expected: number;
  probability: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  baseMult: number;
  group: string;
  age: number | null;
  drivers: string[];
}

/** A dollar figure in short form: $2.75B, $543M, $12.4K. */
function shortUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

/** The three strongest drivers of one row's score, in plain words. */
function driversFor(p: SnapshotProtocol, s: Omit<ScoredValue, 'drivers'>, group: CategoryGroup): string[] {
  const out: string[] = [];
  out.push(`TVL ${shortUsd(p.tvl_usd)} at ${s.baseMult.toFixed(2)}x calibrated (${group.live_comps} live comps)`);
  const g = s.growthPct;
  out.push(g === 0 ? 'TVL flat over 7 days' : `TVL ${g > 0 ? '+' : ''}${g.toFixed(1)}% over 7 days`);
  if (s.age === null) out.push('age unknown, scored as one year old');
  else out.push(`${s.age} days old, ${p.chains.length === 1 ? 'single chain' : `${p.chains.length} chains`}`);
  return out;
}

/** The multipliers and the expected value one protocol gets under the calibrated model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): ScoredValue {
  const age = ageDays(asOf, protocol.listed_at);
  const group = categoryGroup(protocol.category);
  const grp = model.category_groups[group] ?? model.category_groups.other!;
  const baseMult = grp.multiple;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(CALIBRATION.growth_cap, Math.max(CALIBRATION.growth_floor, rawGrowth));
  const growthMult = growthMultiplier(rawGrowth);
  const maturityMult = maturityMultiplier(age);
  const chainMult = chainMultiplier(protocol.chains.length);
  const fdv = Math.max(1, Math.round(protocol.tvl_usd * baseMult * growthMult * maturityMult * chainMult));
  let prob = ageBand(age) + (grp.token_share - 0.2) * 0.5;
  if (rawGrowth > 10) prob += 0.08;
  else if (rawGrowth > 0) prob += 0.04;
  else if (rawGrowth < -10) prob -= 0.08;
  else if (rawGrowth < 0) prob -= 0.04;
  if (Math.abs(rawGrowth) > CALIBRATION.spike_threshold) prob -= CALIBRATION.spike_penalty;
  if (protocol.chains.length >= 5) prob += 0.03;
  else if (protocol.chains.length <= 1) prob -= 0.02;
  prob = Math.min(0.9, Math.max(0.12, prob));
  const expected = Math.max(1, Math.round(fdv * prob));
  const core = {
    fdv,
    expected,
    probability: round4(prob),
    growthPct,
    growthMult,
    maturityMult,
    chainMult,
    baseMult,
    group,
    age,
  };
  return { ...core, drivers: driversFor(protocol, core, grp) };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest expected value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) =>
    b.s.expected - a.s.expected || b.s.fdv - a.s.fdv || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((x, i) => ({
    rank: i + 1,
    slug: x.p.slug,
    name: x.p.name,
    category: x.p.category,
    chains: x.p.chains,
    tvl_usd: x.p.tvl_usd,
    change_7d: x.p.change_7d,
    mcap_usd: x.p.mcap_usd,
    listed_at: x.p.listed_at,
    gecko_id: x.p.gecko_id,
    symbol: x.p.symbol,
    token_status: 'pre-token',
    age_days: x.s.age,
    implied_value_usd: x.s.expected,
    fdv_implied_usd: x.s.fdv,
    expected_value_usd: x.s.expected,
    launch_probability: x.s.probability,
    drivers: x.s.drivers,
    model: {
      base_multiple: x.s.baseMult,
      category_group: x.s.group,
      calibrated_from: (model.category_groups[x.s.group] ?? model.category_groups.other!).live_comps,
      growth_pct: x.s.growthPct,
      growth_multiplier: round4(x.s.growthMult),
      maturity_multiplier: round4(x.s.maturityMult),
      chain_multiplier: round4(x.s.chainMult),
      launch_probability: x.s.probability,
      age_days: x.s.age,
    },
    farm_steps: farmSteps(x.p, x.s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas hint for the protocol's main chain: Ethereum is dear, L2s and Solana are cheap. */
function gasHint(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $8 of gas on Ethereum mainnet';
  if (c === 'solana') return 'under $0.10 of fees on Solana';
  if (c === 'bitcoin' || c === 'tron') return 'a few dollars of network fees';
  return 'about $0.50 of gas on a low-fee chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to the main pool on ${name} (${chain}) and leave it in range.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC across ${name} to ${chain}, then use it inside the destination app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the native asset through ${name} and keep the staking receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as collateral on ${name} and open a single small hedged position.`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name} and let the market settle.`;
  if (c.includes('curator') || c.includes('allocator')) return `Allocate $${capital} to a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Deposit $${capital} to mint the stable asset on ${name} (${chain}) and hold it.`;
  if (c.includes('rwa')) return `Buy $${capital} of the yield-bearing asset on ${name} (${chain}) and hold it through one payout.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover on ${name} (${chain}) and keep the policy active.`;
  return `Put $${capital} of USDC to work in ${name} on ${chain} and leave the position open.`;
}

/** The weekly qualifying action for the category: what counts as activity here. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Borrow a small sum against the deposit and repay it within the same week.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Run one small swap through the pool and top the position up slightly.';
  if (c.includes('bridge')) return 'Send a small amount back, or on to another chain the bridge supports.';
  if (c.includes('staking') || c.includes('restak')) return 'Claim the staking rewards and restake them instead of selling.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Open one small hedge and close it before the week ends.';
  if (c.includes('prediction')) return 'Take one small position and let it resolve.';
  if (c.includes('curator') || c.includes('allocator')) return 'Add a small top-up to the vault or vote on its next allocation.';
  if (c.includes('stable')) return 'Mint or redeem a small amount of the stable asset.';
  if (c.includes('rwa')) return 'Reinvest the yield the asset pays out.';
  if (c.includes('insurance')) return 'Check the cover is still live and renew it before it lapses.';
  return 'Do one real action each week: a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasHint(chain);
  return [
    {
      text: `Set up a wallet used only for this farm, fund it with exactly what you plan to use, and store its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity shows up in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When a claim opens, go to the points or rewards page linked from the protocol's own site or docs and claim only there.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Ignore claim links in DMs, replies and ads: copycat pages look identical to the real one and drain the wallet that connects.`,
      cost: 'nothing to check, and a drained wallet loses everything in it',
      time: '2 minutes',
    },
    {
      text: `Cap this farm at $${capital} and log the wallet, the dates and every transaction, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fdv_implied_usd: row.fdv_implied_usd,
    launch_probability: row.launch_probability,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    drivers: row.drivers,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = calibrate(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (typeof r.launch_probability !== 'number' || r.launch_probability <= 0 || r.launch_probability > 1) return `${r.slug} has launch probability ${r.launch_probability}`;
    if (!Number.isSafeInteger(r.fdv_implied_usd) || r.fdv_implied_usd < r.implied_value_usd) return `${r.slug} has FDV ${r.fdv_implied_usd} below its expected value`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
