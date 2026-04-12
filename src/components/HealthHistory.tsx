import React, { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  getHistory,
  subscribeHealthHistory,
  type ScoreSnapshot,
} from '@/lib/healthHistoryStore';

/** Format ISO timestamp for chart labels */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Custom tooltip for the chart */
function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScoreSnapshot }> }) {
  if (!active || !payload?.[0]) return null;
  const snap = payload[0].payload;
  const d = new Date(snap.ts);

  return (
    <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-neon text-xs">
      <p className="text-muted-foreground mb-1">
        {d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
        {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="font-semibold">
        Score:{' '}
        <span className={snap.score >= 70 ? 'text-safe' : snap.score >= 40 ? 'text-yellow-400' : 'text-destructive'}>
          {snap.score}
        </span>
      </p>
      <p className="text-muted-foreground">
        Risks: {snap.risks} &middot; Acknowledged: {snap.acked}
      </p>
    </div>
  );
}

export function HealthHistory() {
  const [history, setHistory] = useState<ScoreSnapshot[]>(getHistory());

  useEffect(() => {
    const unsub = subscribeHealthHistory(() => setHistory(getHistory()));
    return unsub;
  }, []);

  // Chart data with formatted labels
  const chartData = useMemo(
    () => history.map((snap) => ({ ...snap, label: formatDate(snap.ts) })),
    [history],
  );

  // Trend calculation
  const trend = useMemo(() => {
    if (history.length < 2) return { direction: 'flat' as const, delta: 0 };
    const first = history[0].score;
    const last = history[history.length - 1].score;
    const delta = last - first;
    if (delta > 2) return { direction: 'up' as const, delta };
    if (delta < -2) return { direction: 'down' as const, delta };
    return { direction: 'flat' as const, delta };
  }, [history]);

  // Average score
  const avgScore = useMemo(() => {
    if (history.length === 0) return 0;
    return Math.round(history.reduce((sum, s) => sum + s.score, 0) / history.length);
  }, [history]);

  // Not enough data
  if (history.length < 2) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-border rounded-lg p-5 card-glow"
      >
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Health Score History
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Score history will appear here after your next scan. Come back later to track your wallet's security trend over time.
        </p>
      </motion.div>
    );
  }

  const TrendIcon = trend.direction === 'up' ? TrendingUp : trend.direction === 'down' ? TrendingDown : Minus;
  const trendColor = trend.direction === 'up' ? 'text-safe' : trend.direction === 'down' ? 'text-destructive' : 'text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-5 card-glow"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Health Score History
          </h3>
          <span className="text-[10px] text-muted-foreground">
            ({history.length} snapshots)
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Trend badge */}
          <div className={`flex items-center gap-1 text-[10px] font-semibold ${trendColor}`}>
            <TrendIcon size={12} />
            {trend.delta > 0 ? '+' : ''}{trend.delta} pts
          </div>
          {/* Average */}
          <div className="text-[10px] text-muted-foreground">
            Avg: <span className="text-foreground font-semibold">{avgScore}</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-36 sm:h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(192, 100%, 55%)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(192, 100%, 55%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: 'hsl(250, 8%, 48%)' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 9, fill: 'hsl(250, 8%, 48%)' }}
              tickLine={false}
              axisLine={false}
              tickCount={5}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine
              y={70}
              stroke="hsl(145, 70%, 45%)"
              strokeDasharray="4 4"
              strokeOpacity={0.3}
            />
            <ReferenceLine
              y={40}
              stroke="hsl(0, 80%, 55%)"
              strokeDasharray="4 4"
              strokeOpacity={0.3}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke="hsl(192, 100%, 55%)"
              strokeWidth={2}
              fill="url(#scoreGradient)"
              dot={false}
              activeDot={{
                r: 4,
                fill: 'hsl(192, 100%, 55%)',
                stroke: 'hsl(270, 8%, 8%)',
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-px bg-safe inline-block" style={{ opacity: 0.5 }} /> Good (70+)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-px bg-destructive inline-block" style={{ opacity: 0.5 }} /> At Risk (&lt;40)
        </span>
      </div>
    </motion.div>
  );
}
