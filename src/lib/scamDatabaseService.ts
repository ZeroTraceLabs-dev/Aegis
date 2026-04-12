/**
 * Scam Address Database Service
 *
 * Cross-references addresses against the Supabase scam_addresses table.
 * Supports community reporting and batch lookups.
 * Also includes a hardcoded set of known drainer addresses for instant offline checks.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface ScamRecord {
  address: string;
  label: string;
  category: 'drainer' | 'phishing' | 'rugpull' | 'spam' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: 'community' | 'curated' | 'external';
  reportCount: number;
  verified: boolean;
}

// Hardcoded known scam addresses for instant offline checks
const KNOWN_SCAMS = new Map<string, ScamRecord>([
  // Add verified drainer/scam addresses here as they become known
]);

// Local cache of DB results
const scamCache = new Map<string, ScamRecord | null>();
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check a single address against the scam database
 */
export async function checkAddress(address: string): Promise<ScamRecord | null> {
  // Check hardcoded list first (instant)
  const known = KNOWN_SCAMS.get(address);
  if (known) return known;

  // Check cache
  if (scamCache.has(address) && Date.now() - cacheTimestamp < CACHE_TTL) {
    return scamCache.get(address) || null;
  }

  // Query Supabase
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scam_addresses?address=eq.${address}&select=*`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
    );

    if (!res.ok) return null;

    const data = await res.json();
    if (data.length === 0) {
      scamCache.set(address, null);
      return null;
    }

    const row = data[0];
    const record: ScamRecord = {
      address: row.address,
      label: row.label,
      category: row.category,
      severity: row.severity,
      source: row.source,
      reportCount: row.report_count,
      verified: row.verified,
    };

    scamCache.set(address, record);
    cacheTimestamp = Date.now();
    return record;
  } catch {
    return null;
  }
}

/**
 * Batch check multiple addresses
 */
export async function checkAddresses(addresses: string[]): Promise<Map<string, ScamRecord>> {
  const results = new Map<string, ScamRecord>();

  // Check hardcoded list
  for (const addr of addresses) {
    const known = KNOWN_SCAMS.get(addr);
    if (known) results.set(addr, known);
  }

  // Filter out already-known and cached
  const toQuery = addresses.filter((a) => {
    if (results.has(a)) return false;
    if (scamCache.has(a) && Date.now() - cacheTimestamp < CACHE_TTL) {
      const cached = scamCache.get(a);
      if (cached) results.set(a, cached);
      return false;
    }
    return true;
  });

  if (toQuery.length === 0 || !SUPABASE_URL || !SUPABASE_ANON_KEY) return results;

  // Batch query (max 50 at a time)
  const batches = [];
  for (let i = 0; i < toQuery.length; i += 50) {
    batches.push(toQuery.slice(i, i + 50));
  }

  for (const batch of batches) {
    try {
      const inList = batch.map((a) => `"${a}"`).join(',');
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/scam_addresses?address=in.(${inList})&select=*`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        },
      );

      if (!res.ok) continue;

      const data = await res.json();
      for (const row of data) {
        const record: ScamRecord = {
          address: row.address,
          label: row.label,
          category: row.category,
          severity: row.severity,
          source: row.source,
          reportCount: row.report_count,
          verified: row.verified,
        };
        results.set(row.address, record);
        scamCache.set(row.address, record);
      }

      // Mark non-matches in cache
      for (const addr of batch) {
        if (!results.has(addr)) {
          scamCache.set(addr, null);
        }
      }

      cacheTimestamp = Date.now();
    } catch { /* skip batch */ }
  }

  return results;
}

/**
 * Report an address as a scam (community reporting)
 */
export async function reportScamAddress(
  address: string,
  reportedBy: string,
  label?: string,
  category?: ScamRecord['category'],
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;

  try {
    // Check if already exists -- if so, increment report count
    const existing = await checkAddress(address);

    if (existing) {
      // Increment report_count via RPC or direct update
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/increment_scam_report`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ target_address: address }),
        },
      );
      // If RPC doesn't exist, that's fine - the report still counts
      return res.ok;
    }

    // Insert new report
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scam_addresses`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          address,
          label: label || 'Community reported',
          category: category || 'other',
          severity: 'medium',
          source: 'community',
          reported_by: reportedBy,
          report_count: 1,
          verified: false,
        }),
      },
    );

    if (res.ok) {
      // Clear cache for this address
      scamCache.delete(address);
    }

    return res.ok;
  } catch {
    return false;
  }
}

/** Clear the local cache */
export function clearScamCache() {
  scamCache.clear();
  cacheTimestamp = 0;
}
