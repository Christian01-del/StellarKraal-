/**
 * Collateral business logic — decoupled from HTTP layer for v1/v2 reuse.
 */
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { stellarPublicKeySchema } from '../validators/stellar';
import { getCollateral } from '../db/store';
import { buildContractTx } from './contractTx';

/**
 * Zod schema that validates a single collateral registration payload.
 * Enforces that `owner` is a valid Stellar public key, `animal_type` is a
 * non-empty string, and `count` / `appraised_value` are positive integers.
 */
export const registerCollateralSchema = z.object({
  owner: stellarPublicKeySchema,
  animal_type: z.string().min(1),
  count: z.number().int().positive(),
  appraised_value: z.number().int().positive(),
});

/** Inferred TypeScript type for a validated single collateral registration payload. */
export type RegisterCollateralInput = z.infer<typeof registerCollateralSchema>;

/**
 * Zod schema that validates a batch collateral registration payload.
 * Enforces that `items` contains between 1 and 50 valid
 * {@link registerCollateralSchema} entries.
 */
export const batchRegisterCollateralSchema = z.object({
  items: z
    .array(registerCollateralSchema)
    .min(1, 'items must contain at least one entry')
    .max(50, 'items must not exceed 50 entries per batch'),
});

/** Inferred TypeScript type for a validated batch collateral registration payload. */
export type BatchRegisterCollateralInput = z.infer<typeof batchRegisterCollateralSchema>;

/**
 * Default TTL (ms) for cached collateral appraisal results — 5 minutes.
 * Overridable via the `COLLATERAL_APPRAISAL_CACHE_TTL_MS` env var.
 */
const DEFAULT_APPRAISAL_TTL_MS = 5 * 60 * 1000;

/**
 * Default TTL (ms) for cached oracle price feed results — 60 seconds.
 * Overridable via the `PRICE_FEED_CACHE_TTL_MS` env var.
 */
const DEFAULT_PRICE_FEED_TTL_MS = 60 * 1000;

function resolveTtl(envValue: string | undefined, fallback: number): number {
  const parsed = envValue !== undefined ? Number(envValue) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Configurable TTL for collateral appraisal cache entries (ms). */
export const collateralAppraisalTtlMs = resolveTtl(
  process.env.COLLATERAL_APPRAISAL_CACHE_TTL_MS,
  DEFAULT_APPRAISAL_TTL_MS
);

/** Configurable TTL for oracle price feed cache entries (ms). */
export const priceFeedTtlMs = resolveTtl(
  process.env.PRICE_FEED_CACHE_TTL_MS,
  DEFAULT_PRICE_FEED_TTL_MS
);

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Minimal in-memory TTL cache with hit/miss counters, used for collateral
 * appraisal and oracle price feed lookups.
 */
class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }
}

const appraisalCache = new TtlCache<unknown>(collateralAppraisalTtlMs);
const priceFeedCache = new TtlCache<unknown>(priceFeedTtlMs);

/**
 * Returns cache hit/miss counters for collateral appraisal and oracle price
 * feed caches, suitable for exposure on the /metrics endpoint.
 */
export function getCacheMetrics(): {
  collateral_appraisal_cache_hits: number;
  collateral_appraisal_cache_misses: number;
  price_feed_cache_hits: number;
  price_feed_cache_misses: number;
} {
  const appraisal = appraisalCache.stats();
  const priceFeed = priceFeedCache.stats();
  return {
    collateral_appraisal_cache_hits: appraisal.hits,
    collateral_appraisal_cache_misses: appraisal.misses,
    price_feed_cache_hits: priceFeed.hits,
    price_feed_cache_misses: priceFeed.misses,
  };
}

/**
 * Returns a cached collateral appraisal result for the given key, computing and
 * caching it via `loader` on a miss.
 *
 * @param key - Cache key identifying the collateral appraisal.
 * @param loader - Function that computes the appraisal on a cache miss.
 */
export async function getCachedCollateralAppraisal<T>(
  key: string,
  loader: () => Promise<T>
): Promise<T> {
  const cached = appraisalCache.get(key) as T | undefined;
  if (cached !== undefined) {
    return cached;
  }
  const value = await loader();
  appraisalCache.set(key, value);
  return value;
}

/**
 * Returns a cached oracle price feed result for the given key, computing and
 * caching it via `loader` on a miss.
 *
 * @param key - Cache key identifying the price feed lookup.
 * @param loader - Function that fetches the price on a cache miss.
 */
export async function getCachedPriceFeed<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = priceFeedCache.get(key) as T | undefined;
  if (cached !== undefined) {
    return cached;
  }
  const value = await loader();
  priceFeedCache.set(key, value);
  return value;
}

/**
 * Invalidates cached collateral appraisal results. Called when collateral data
 * is updated so subsequent health factor calculations see fresh values.
 *
 * @param key - Optional specific cache key to invalidate; clears all appraisal
 *   entries when omitted.
 */
export function invalidateCollateralAppraisalCache(key?: string): void {
  if (key === undefined) {
    appraisalCache.clear();
  } else {
    appraisalCache.delete(key);
  }
}

/**
 * Builds a `register_livestock` Soroban contract transaction for a single animal
 * registration.
 *
 * @param input - Validated collateral registration payload (see
 *   {@link registerCollateralSchema}).
 * @returns Unsigned XDR transaction envelope ready for client-side signing.
 * @throws If the RPC simulation or transaction preparation fails.
 */
export async function registerCollateral(input: RegisterCollateralInput): Promise<{ xdr: string }> {
  const { owner, animal_type, count, appraised_value } = input;
  const xdrTx = await buildContractTx(owner, 'register_livestock', [
    new Address(owner).toScVal(),
    nativeToScVal(animal_type, { type: 'symbol' }),
    nativeToScVal(count, { type: 'u32' }),
    nativeToScVal(BigInt(appraised_value), { type: 'i128' }),
  ]);
  return { xdr: xdrTx };
}

/**
 * Builds `register_livestock` transactions for multiple collateral items in one
 * call, using {@link registerCollateral} for each item and resolving all
 * promises concurrently.
 *
 * @param input - Validated batch payload containing 1–50 registration items
 *   (see {@link batchRegisterCollateralSchema}).
 * @returns An object whose `results` array contains one `{ xdr }` entry per
 *   input item, in the same order as the input.
 * @throws If any individual RPC simulation or transaction preparation fails.
 */
export async function batchRegisterCollateral(
  input: BatchRegisterCollateralInput
): Promise<{ results: Array<{ xdr: string }> }> {
  const results = await Promise.all(input.items.map((item) => registerCollateral(item)));
  return { results };
}

/**
 * Fetches a collateral record from the local off-chain database by its ID.
 *
 * @param id - Collateral record identifier (stringified integer primary key).
 * @returns The collateral record object, or `undefined` if no record with that
 *   ID exists.
 */
export function getCollateralById(id: string) {
  return getCollateral(id);
}
