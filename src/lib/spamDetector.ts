/**
 * Spam / Scam NFT Detector
 *
 * Scores each NFT 0–100 (higher = more likely spam).
 * Threshold: >= 50 = flagged as spam.
 *
 * Signals used:
 *  DAS-level:
 *   - Helius `spam` classification (if present)            +60
 *   - `burnt` flag                                          +80
 *   - No verified creator                                   +20
 *   - 0% royalties (royalty_model = "free")                 +10
 *   - Not in any collection                                 +15
 *
 *  Heuristic:
 *   - Name contains known spam keywords                     +35
 *   - Name looks like a URL / phishing lure                 +40
 *   - Name is suspiciously short (1 char) or empty          +15
 *   - Symbol is empty while name exists                     +5
 *   - Image URL points to known scam CDN pattern            +25
 *   - Compressed with no collection                         +10
 */

export interface SpamSignals {
  /** Helius DAS marked as spam */
  dasSpam?: boolean;
  /** Asset is burnt on-chain */
  burnt?: boolean;
  /** No creator with verified=true */
  noVerifiedCreator?: boolean;
  /** Royalty model from DAS ("free" / "creators" / ...) */
  royaltyModel?: string;
  /** Royalty basis points */
  royaltyBps?: number;
  /** Whether the NFT belongs to any collection */
  hasCollection?: boolean;
  /** Whether the NFT is compressed */
  compressed?: boolean;
}

export interface SpamResult {
  score: number;        // 0-100
  isSpam: boolean;      // score >= 50
  reasons: string[];    // human-readable reasons
}

/* ── Known spam keyword patterns ──────────────────────────── */

const SPAM_KEYWORDS = [
  'airdrop', 'claim', 'free mint', 'visit', 'redeem',
  'congratulations', 'winner', 'reward', 'voucher',
  'giveaway', 'bonus', '.com', '.xyz', '.io', '.org',
  'http', 'www.', 't.me/', 'discord.gg',
  'limited time', 'act now', 'expire',
  'verify wallet', 'connect wallet',
  '$', 'usdt', 'usdc airdrop',
];

const URL_REGEX = /https?:\/\/|www\.|\.com|\.xyz|\.io|\.net|\.org|\.gg|t\.me\//i;
const PHISHING_NAME_REGEX = /(?:claim|redeem|free|bonus|reward|visit)\s/i;

/* ── Known scam image CDN patterns ────────────────────────── */

const SCAM_IMAGE_PATTERNS = [
  'nftstorage.link/ipfs/baf', // very generic but combined with other signals
  'gateway.irys.xyz',         // not inherently bad but often used in spam
];

/* ── Scoring function ──────��──────────────────────────────── */

export function scoreSpam(
  name: string,
  symbol: string,
  image: string,
  signals: SpamSignals,
): SpamResult {
  let score = 0;
  const reasons: string[] = [];

  // ── DAS-level signals ──

  if (signals.dasSpam) {
    score += 60;
    reasons.push('Flagged as spam by Helius DAS');
  }

  if (signals.burnt) {
    score += 80;
    reasons.push('Asset is burnt on-chain');
  }

  if (signals.noVerifiedCreator) {
    score += 20;
    reasons.push('No verified creator');
  }

  if (signals.royaltyModel === 'free' || signals.royaltyBps === 0) {
    score += 10;
    reasons.push('Zero royalties (common in spam)');
  }

  if (signals.hasCollection === false) {
    score += 15;
    reasons.push('Not in any verified collection');
  }

  if (signals.compressed && signals.hasCollection === false) {
    score += 10;
    reasons.push('Compressed NFT with no collection');
  }

  // ── Name heuristics ──

  const nameLower = (name || '').toLowerCase().trim();

  if (!nameLower || nameLower.length <= 1) {
    score += 15;
    reasons.push('Empty or single-character name');
  }

  if (URL_REGEX.test(nameLower)) {
    score += 40;
    reasons.push('Name contains a URL (phishing indicator)');
  } else if (PHISHING_NAME_REGEX.test(nameLower)) {
    score += 35;
    reasons.push('Name contains phishing keywords');
  } else {
    // Check individual spam keywords
    for (const kw of SPAM_KEYWORDS) {
      if (nameLower.includes(kw)) {
        score += 35;
        reasons.push(`Name contains spam keyword: "${kw}"`);
        break; // only count once
      }
    }
  }

  // ── Symbol heuristic ──

  if (!symbol && name) {
    score += 5;
    reasons.push('No symbol defined');
  }

  // ── Image heuristic ──

  const imgLower = (image || '').toLowerCase();
  for (const pattern of SCAM_IMAGE_PATTERNS) {
    if (imgLower.includes(pattern)) {
      // Only add if other signals also present (avoid false positives)
      if (score >= 20) {
        score += 10;
        reasons.push('Image hosted on pattern associated with spam');
      }
      break;
    }
  }

  // Cap at 100
  score = Math.min(score, 100);

  return {
    score,
    isSpam: score >= 50,
    reasons,
  };
}

/**
 * Quick check — is the name alone suspicious enough to warrant caution?
 */
export function isNameSuspicious(name: string): boolean {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  if (URL_REGEX.test(lower)) return true;
  if (PHISHING_NAME_REGEX.test(lower)) return true;
  for (const kw of SPAM_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}
