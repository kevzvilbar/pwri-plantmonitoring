import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  LabelList,
} from 'recharts';
import { cn } from '@/lib/utils';
import { fmtNum } from '@/lib/calculations';
import type { WaterfallItem } from './useBudgetWaterfall';

export function WaterfallChart({ waterfallRows }: { waterfallRows: WaterfallItem[] }) {
  return (
    <div className="h-72 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={waterfallRows} margin={{ top: 20, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fontWeight: 500, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 10.5, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `₱${(v / 1000).toFixed(0)}k` : `₱${v}`)}
            axisLine={false}
            tickLine={false}
            width={55}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const data = payload[0]?.payload;
              if (!data) return null;

              return (
                <div className="p-3 rounded-xl bg-card/95 border border-border shadow-xl backdrop-blur-md text-xs space-y-1.5 min-w-[200px]">
                  <div className="font-bold text-foreground border-b border-border/60 pb-1 flex items-center justify-between gap-2">
                    <span>{data.name}</span>
                    {data.kind === 'start' ? (
                      <span className="text-3xs font-mono uppercase bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-semibold">
                        Baseline Target
                      </span>
                    ) : data.kind === 'end' ? (
                      <span className="text-3xs font-mono uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">
                        Total Actual OPEX
                      </span>
                    ) : data.kind === 'variance' ? (
                      data.rawAmount > 0 ? (
                        <span className="text-3xs font-mono uppercase bg-danger-soft text-danger px-1.5 py-0.5 rounded font-bold">
                          Over Budget (+Cost)
                        </span>
                      ) : data.rawAmount < 0 ? (
                        <span className="text-3xs font-mono uppercase bg-accent-soft text-accent px-1.5 py-0.5 rounded font-bold">
                          Under Budget (Savings)
                        </span>
                      ) : (
                        <span className="text-3xs font-mono uppercase bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                          On Target
                        </span>
                      )
                    ) : (
                      <span className="text-3xs font-mono uppercase bg-muted/60 text-foreground px-1.5 py-0.5 rounded font-medium">
                        Cost Component
                      </span>
                    )}
                  </div>

                  {data.kind === 'start' && (
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground">
                        Planned Budget: <strong className="text-foreground font-mono-num">₱{fmtNum(data.rawAmount, 0)}</strong>
                      </div>
                    </div>
                  )}

                  {data.kind === 'delta' && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Expense Amount:</span>
                        <span className="font-mono-num font-bold text-foreground">₱{fmtNum(data.rawAmount, 0)}</span>
                      </div>
                      {data.budget > 0 && (
                        <div className="flex justify-between text-muted-foreground border-t border-border/40 pt-0.5">
                          <span>Allocated Plan:</span>
                          <span className="font-mono-num">₱{fmtNum(data.budget, 0)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {data.kind === 'end' && (
                    <div className="space-y-1">
                      <div className="text-muted-foreground">
                        Total Actual Spent: <strong className="text-primary font-mono-num font-bold">₱{fmtNum(data.rawAmount, 0)}</strong>
                      </div>
                      <div className="text-3xs text-muted-foreground border-t border-border/40 pt-1 flex justify-between">
                        <span>Net Variance:</span>
                        <span className={cn('font-mono-num font-bold', data.rawAmount > data.budget ? 'text-danger' : 'text-accent')}>
                          {data.rawAmount >= data.budget ? '+' : ''}₱{fmtNum(data.rawAmount - data.budget, 0)} (
                          {(((data.rawAmount - data.budget) / (data.budget || 1)) * 100).toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  )}

                  {data.kind === 'variance' && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Budget Baseline:</span>
                        <span className="font-mono-num">₱{fmtNum(data.budget, 0)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Actual Incurred:</span>
                        <span className="font-mono-num font-semibold text-foreground">₱{fmtNum(data.actual, 0)}</span>
                      </div>
                      <div className="flex justify-between border-t border-border/40 pt-1">
                        <span className="font-medium">Variance Delta:</span>
                        <span
                          className={cn(
                            'font-mono-num font-bold',
                            data.rawAmount > 0 ? 'text-danger' : data.rawAmount < 0 ? 'text-accent' : 'text-muted-foreground'
                          )}
                        >
                          {data.rawAmount > 0 ? '+' : ''}₱{fmtNum(data.rawAmount, 0)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="base" stackId="bridge" isAnimationActive={false}>
            {waterfallRows.map((r, i) => (
              <Cell key={`base-${r.name}-${i}`} fill="transparent" />
            ))}
          </Bar>
          <Bar
            dataKey="height"
            stackId="bridge"
            radius={[4, 4, 4, 4]}
            isAnimationActive={false}
          >
            {waterfallRows.map((r, i) => (
              <Cell key={`bar-${r.name}-${i}`} fill={r.fill} />
            ))}
            <LabelList
              dataKey="deltaLabel"
              position="top"
              style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'monospace' }}
              fill="hsl(var(--foreground))"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
