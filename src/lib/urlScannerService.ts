/**
 * URL Scanner Service
 *
 * Analyzes a URL for phishing indicators:
 *  - Typosquatting of known Solana/DeFi domains
 *  - Suspicious TLDs
 *  - Obfuscation patterns (IP addresses, encoded chars, excessive subdomains)
 *  - Known phishing keywords
 *  - Protocol anomalies
 */

import type { SimulationFlag } from '@/lib/txSimulatorService';

export interface UrlScanResult {
  url: string;
  domain: string;
  isPhishing: boolean;
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  score: number; // 0 (dangerous) – 100 (safe)
  flags: SimulationFlag[];
  matchedLegitDomain?: string; // if typosquatting detected
}

// Legitimate Solana / DeFi domains
const LEGIT_DOMAINS: Record<string, string> = {
  'phantom.app': 'Phantom Wallet',
  'solflare.com': 'Solflare Wallet',
  'backpack.app': 'Backpack Wallet',
  'jup.ag': 'Jupiter',
  'jupiter.ag': 'Jupiter',
  'raydium.io': 'Raydium',
  'orca.so': 'Orca',
  'marinade.finance': 'Marinade',
  'solscan.io': 'Solscan',
  'solana.com': 'Solana',
  'solana.fm': 'Solana FM',
  'tensor.trade': 'Tensor',
  'magiceden.io': 'Magic Eden',
  'metaplex.com': 'Metaplex',
  'helius.dev': 'Helius',
  'birdeye.so': 'Birdeye',
  'dexscreener.com': 'DexScreener',
  'step.finance': 'Step Finance',
  'kamino.finance': 'Kamino',
  'drift.trade': 'Drift',
  'marginfi.com': 'MarginFi',
  'sanctum.so': 'Sanctum',
  'pyth.network': 'Pyth Network',
  'wormhole.com': 'Wormhole',
  'switchboard.xyz': 'Switchboard',
  'bonk.com': 'BONK',
  'pump.fun': 'Pump.fun',
  'meteora.ag': 'Meteora',
};

// Suspicious TLDs often used in phishing
const SUSPICIOUS_TLDS = new Set([
  '.xyz', '.top', '.club', '.online', '.site', '.info', '.buzz',
  '.icu', '.ws', '.tk', '.ml', '.ga', '.cf', '.gq',
  '.cam', '.click', '.link', '.live', '.rest', '.surf',
]);

// Phishing keywords in URLs
const PHISHING_KEYWORDS = [
  'airdrop', 'claim', 'reward', 'bonus', 'free-mint',
  'connect-wallet', 'verify-wallet', 'sync-wallet',
  'restore', 'validate', 'confirm-wallet', 'secure-wallet',
  'login-wallet', 'wallet-update', 'mint-free',
  'seed-phrase', 'private-key', 'recovery-phrase',
];

/**
 * Levenshtein distance for typosquatting detection
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Extract the registrable domain (last two parts) from a hostname
 */
function extractDomain(hostname: string): string {
  const parts = hostname.replace(/\.$/, '').split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

/**
 * Scan a URL for phishing indicators
 */
export function scanUrl(rawUrl: string): UrlScanResult {
  const flags: SimulationFlag[] = [];
  let score = 100;

  // Normalize URL
  let url = rawUrl.trim();
  if (!url.match(/^https?:\/\//i)) {
    url = 'https://' + url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      url: rawUrl,
      domain: rawUrl,
      isPhishing: false,
      riskLevel: 'high',
      score: 10,
      flags: [{ severity: 'danger', message: 'Invalid URL format -- could not parse' }],
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const domain = extractDomain(hostname);
  const fullPath = parsed.pathname + parsed.search + parsed.hash;

  // --- Check 1: Is this an exact known legitimate domain? ---
  if (LEGIT_DOMAINS[domain]) {
    flags.push({
      severity: 'info',
      message: `Verified domain: ${domain} is the official ${LEGIT_DOMAINS[domain]} website`,
    });
    return {
      url, domain, isPhishing: false, riskLevel: 'safe', score: 98, flags,
    };
  }

  // --- Check 2: HTTP instead of HTTPS ---
  if (parsed.protocol === 'http:') {
    score -= 15;
    flags.push({
      severity: 'warning',
      message: 'Site uses HTTP (not HTTPS) -- connection is not encrypted',
    });
  }

  // --- Check 3: IP address instead of domain ---
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    score -= 30;
    flags.push({
      severity: 'danger',
      message: 'URL uses a raw IP address instead of a domain name -- common in phishing',
    });
  }

  // --- Check 4: Suspicious TLD ---
  for (const tld of SUSPICIOUS_TLDS) {
    if (hostname.endsWith(tld)) {
      score -= 10;
      flags.push({
        severity: 'warning',
        message: `Suspicious TLD "${tld}" -- commonly used in phishing sites`,
      });
      break;
    }
  }

  // --- Check 5: Excessive subdomains (hiding real domain) ---
  const subdomainCount = hostname.split('.').length - 2;
  if (subdomainCount >= 3) {
    score -= 15;
    flags.push({
      severity: 'warning',
      message: `${subdomainCount} subdomains detected -- excessive depth may hide the real domain`,
    });
  }

  // --- Check 6: Typosquatting detection ---
  let closestMatch: { domain: string; label: string; dist: number } | null = null;

  for (const [legitDomain, label] of Object.entries(LEGIT_DOMAINS)) {
    const dist = levenshtein(domain, legitDomain);
    // Close but not exact = typosquat
    if (dist > 0 && dist <= 2) {
      if (!closestMatch || dist < closestMatch.dist) {
        closestMatch = { domain: legitDomain, label, dist };
      }
    }
    // Also check if legit domain name appears as a subdomain
    const baseName = legitDomain.split('.')[0];
    if (hostname.includes(baseName) && domain !== legitDomain) {
      if (!closestMatch || 1 < closestMatch.dist) {
        closestMatch = { domain: legitDomain, label, dist: 1 };
      }
    }
  }

  if (closestMatch) {
    score -= 35;
    flags.push({
      severity: 'danger',
      message: `Possible typosquat of "${closestMatch.domain}" (${closestMatch.label}) -- verify the domain carefully`,
    });
  }

  // --- Check 7: Phishing keywords in URL ---
  const lowerUrl = url.toLowerCase();
  const matchedKeywords = PHISHING_KEYWORDS.filter((kw) => lowerUrl.includes(kw));
  if (matchedKeywords.length > 0) {
    score -= matchedKeywords.length * 8;
    flags.push({
      severity: matchedKeywords.length >= 2 ? 'danger' : 'warning',
      message: `Phishing keywords found in URL: ${matchedKeywords.map((k) => `"${k}"`).join(', ')}`,
    });
  }

  // --- Check 8: Encoded characters / obfuscation ---
  if (/%[0-9a-f]{2}/i.test(fullPath) && fullPath.length > 50) {
    score -= 10;
    flags.push({
      severity: 'warning',
      message: 'URL contains encoded characters -- may be obfuscating the real destination',
    });
  }

  // --- Check 9: Very long URL ---
  if (url.length > 200) {
    score -= 5;
    flags.push({
      severity: 'info',
      message: 'Unusually long URL -- review the full path carefully',
    });
  }

  // --- Check 10: @ symbol in URL (redirects) ---
  if (url.includes('@')) {
    score -= 25;
    flags.push({
      severity: 'danger',
      message: 'URL contains "@" symbol -- this can trick browsers into redirecting to a different site',
    });
  }

  // --- Check 11: Multiple hyphens (common in phishing domains) ---
  const domainBase = domain.split('.')[0];
  const hyphenCount = (domainBase.match(/-/g) || []).length;
  if (hyphenCount >= 3) {
    score -= 10;
    flags.push({
      severity: 'warning',
      message: `Domain has ${hyphenCount} hyphens -- unusual for legitimate sites`,
    });
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // No flags = likely OK
  if (flags.length === 0) {
    flags.push({
      severity: 'info',
      message: 'No known phishing indicators detected -- always verify independently',
    });
  }

  const riskLevel: UrlScanResult['riskLevel'] =
    score >= 80 ? 'low' :
    score >= 60 ? 'medium' :
    score >= 30 ? 'high' : 'critical';

  return {
    url,
    domain,
    isPhishing: score < 40,
    riskLevel,
    score,
    flags,
    matchedLegitDomain: closestMatch?.domain,
  };
}
