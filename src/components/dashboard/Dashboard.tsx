import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleDot, Clock, Cloud, FileText, MoreHorizontal, Plus, Rocket, Target, TrendingUp, User, Users, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '../../lib/utils';
import { SubHeader } from '../SubHeader';

const RadialProgress = ({
  value,
  radius,
  strokeWidth,
  color,
  delay = 0,
}: {
  value: number;
  radius: number;
  strokeWidth: number;
  color: string;
  delay?: number;
}) => {
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <g className="transform -rotate-90 origin-center">
      <circle
        cx="120"
        cy="120"
        r={radius}
        fill="transparent"
        stroke="#1e293b"
        strokeWidth={strokeWidth}
        className="opacity-30"
      />
      <motion.circle
        cx="120"
        cy="120"
        r={radius}
        fill="transparent"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.5, delay, ease: 'easeOut' }}
        strokeLinecap="round"
      />
    </g>
  );
};

const MetricCard = ({
  title,
  value,
  icon: Icon,
  trend,
  trendValue,
}: {
  title: string;
  value: string | number;
  icon: any;
  trend?: 'up' | 'down';
  trendValue?: string;
}) => (
  <div
    className="glass-card p-3 sm:p-3.5 flex flex-col justify-between min-h-[100px] sm:h-28 transition-colors group !border-transparent"
    style={{
      backgroundColor: 'var(--surface)',
    }}
  >
    <div className="flex justify-between items-center gap-2 min-w-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <div
          className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl border transition-colors shrink-0"
          style={{
            backgroundColor: 'var(--control-bg)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <Icon
            className="transition-colors"
            size={18}
            style={{ color: 'var(--text)' }}
          />
        </div>
        <span className="text-xs font-medium text-secondary truncate">{title}</span>
      </div>
      <button
        className="p-1 rounded-full transition-colors"
        style={{
          color: 'var(--text-muted)',
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>

    <div className="flex items-end justify-between pt-2 sm:pt-2.5 gap-2">
      <p className="text-lg sm:text-xl font-bold tracking-tight leading-none truncate min-w-0" style={{ color: 'var(--text)' }}>
        {value}
      </p>
      {trendValue && (
        <div
          className={cn(
            'flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full',
            trend === 'up' ? 'text-emerald-400 bg-emerald-400/10' : 'text-orange-400 bg-orange-400/10',
          )}
        >
          <TrendingUp size={10} className={trend === 'down' ? 'rotate-180' : ''} />
          {trendValue}
        </div>
      )}
    </div>
  </div>
);

export function Dashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [timeStr, ampm] = currentTime
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    .split(' ');

  const year = currentTime.getFullYear();
  const month = currentTime.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay();

  return (
    <>
      <SubHeader />

      <div className="grid grid-cols-12 gap-3 sm:gap-4 lg:gap-5">
        {/* Left side: hero + 4 cards (single block) */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-3 sm:gap-4">
          {/* Welcome + Weather Card (from provided design) */}
          <div
            className="relative overflow-hidden rounded-2xl sm:rounded-3xl px-4 py-5 sm:px-6 sm:py-6 !border-transparent"
            style={{
              backgroundColor: 'var(--surface)',
              boxShadow:
                '0 6px 16px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
            }}
          >
            {/* Subtle Glow Effect */}
            <div className="pointer-events-none absolute -top-32 -right-32 h-80 w-80 rounded-full bg-blue-600/30 blur-[100px]" />

            <div className="relative flex flex-col md:flex-row justify-between gap-5 sm:gap-6">
              {/* Left Side: Greeting and Time */}
              <div className="flex flex-col justify-between space-y-5 sm:space-y-8">
                <div>
                  <h3 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                    Nice to see you, Demo
                  </h3>
                  <p className="mt-1.5 sm:mt-2 text-xs md:text-sm text-secondary flex items-center gap-2 flex-wrap">
                    Ready to make today productive!
                    <Rocket className="w-4 h-4 shrink-0" />
                  </p>
                </div>

                <div className="flex items-baseline gap-2">
                  <span
                    className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tighter"
                    style={{ color: 'var(--text)' }}
                  >
                    {timeStr}
                  </span>
                  <span
                    className="text-base sm:text-lg md:text-xl font-bold opacity-80 uppercase"
                    style={{ color: 'var(--text)' }}
                  >
                    {ampm}
                  </span>
                </div>
              </div>

              {/* Right Side: Weather and Date */}
              <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-between gap-4 md:gap-0 text-left md:text-right">
                <div className="flex items-center gap-3">
                  <Cloud
                    className="w-10 h-10 md:w-12 md:h-12 shrink-0"
                    style={{ color: 'var(--text)' }}
                  />
                  <div className="flex flex-col">
                    <span
                      className="text-2xl sm:text-3xl md:text-4xl font-bold"
                      style={{ color: 'var(--text)' }}
                    >
                      22°C
                    </span>
                  </div>
                </div>

                <div className="md:mt-4 space-y-0.5 md:space-y-1">
                  <p className="text-xs sm:text-sm font-medium text-secondary">Overcast</p>
                  <p className="text-xs font-semibold text-secondary">Freeport</p>
                  <p className="text-[10px] sm:text-xs text-secondary">
                    {currentTime.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Metrics row directly under hero */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <MetricCard title="Total Projects" value="24" icon={FileText} trend="up" trendValue="+3" />
            <MetricCard title="Active Users" value="1,847" icon={Users} trend="up" trendValue="+12%" />
            <MetricCard title="Task Completion" value="78%" icon={TrendingUp} trend="up" trendValue="+5%" />
            <MetricCard title="Avg. Response Time" value="32 min" icon={Clock} trend="down" trendValue="0%" />
          </div>
        </div>

        {/* Insights Card on the right, same row height */}
        <div
          className="col-span-12 lg:col-span-4 glass-card p-4 sm:p-6 flex flex-col !border-transparent"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <h4
            className="text-base font-bold mb-0.5"
            style={{ color: 'var(--text)' }}
          >
            Insights
          </h4>
          <p className="text-xs text-secondary mb-4 md:mb-6">Performance analytics</p>

          <div
            className="flex gap-2 p-1 rounded-xl mb-4 md:mb-6 border"
            style={{
              backgroundColor: 'var(--control-bg)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <button
              className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2.5 sm:py-2 min-h-[44px] rounded-lg text-xs font-bold shadow-sm"
              style={{
                backgroundColor: 'var(--nav-active-bg)',
                color: 'var(--nav-active-text)',
              }}
            >
              <Target size={14} /> <span className="truncate">Performance</span>
            </button>
            <button className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2.5 sm:py-2 min-h-[44px] text-secondary text-xs font-bold hover:text-[var(--text)] transition-colors">
              <TrendingUp size={14} /> <span className="truncate">Trends</span>
            </button>
          </div>

          <div
            className="flex-1 rounded-2xl p-4 md:p-6 border flex flex-col"
            style={{
              backgroundColor: 'var(--control-bg)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {/* Mobile: stack vertically; Desktop: side-by-side */}
            <div className="flex flex-col md:flex-row items-center md:items-center gap-5 md:gap-5">
              <div className="relative w-32 h-32 sm:w-36 sm:h-36 md:w-40 md:h-40 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full" viewBox="0 0 240 240" preserveAspectRatio="xMidYMid meet">
                  <RadialProgress value={85} radius={90} strokeWidth={12} color="#3b82f6" delay={0} />
                  <RadialProgress value={84} radius={70} strokeWidth={12} color="#22c55e" delay={0.2} />
                  <RadialProgress value={78} radius={50} strokeWidth={12} color="#64748b" delay={0.4} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.span
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: 0.8 }}
                    className="text-lg md:text-xl font-extrabold tracking-tight"
                    style={{ color: 'var(--text)' }}
                  >
                    85%
                  </motion.span>
                </div>
              </div>

              <div className="w-full min-w-0 md:flex-1 space-y-4 md:space-y-5">
                {[
                  {
                    label: 'Task Completion',
                    value: '85%',
                    subtext: 'Overall completion rate',
                    icon: CircleDot,
                    color: 'text-blue-400',
                    bgColor: 'bg-blue-400/10',
                  },
                  {
                    label: 'User Engagement',
                    value: '84%',
                    subtext: 'Active user participation',
                    icon: User,
                    color: 'text-emerald-400',
                    bgColor: 'bg-emerald-400/10',
                  },
                  {
                    label: 'Response Time',
                    value: '78%',
                    subtext: 'Average response efficiency',
                    icon: Clock,
                    color: 'text-secondary',
                    bgColor: 'bg-zinc-500/10',
                  },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 group min-w-0">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn('p-2 rounded-full shrink-0 transition-colors', item.bgColor)}>
                        <item.icon size={16} className={item.color} />
                      </div>
                      <div className="min-w-0">
                        <p
                          className="text-xs font-bold leading-none mb-1 truncate sm:whitespace-normal"
                          style={{ color: 'var(--text)' }}
                        >
                          {item.label}
                        </p>
                        <p className="text-[10px] text-secondary leading-none line-clamp-2">{item.subtext}</p>
                      </div>
                    </div>
                    <span className={cn('text-xs font-bold shrink-0', item.color)}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Tasks */}
        <div className="col-span-12 md:col-span-6 xl:col-span-5 glass-card p-4 sm:p-6 !border-transparent lg:-mt-18.5" style={{ backgroundColor: 'var(--surface)' }}>
          <h4
            className="text-sm font-bold mb-1"
            style={{ color: 'var(--text)' }}
          >
            Quick Tasks
          </h4>
          <p className="text-[10px] text-secondary mb-4 sm:mb-6">Manage your daily tasks</p>

          <div
            className="flex gap-2 p-1 rounded-xl mb-4 sm:mb-6 border"
            style={{
              backgroundColor: 'var(--control-bg)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <button
              className="flex-1 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-[10px] font-bold shadow-sm"
              style={{
                backgroundColor: 'var(--nav-active-bg)',
                color: 'var(--nav-active-text)',
              }}
            >
              Active (3)
            </button>
            <button className="flex-1 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-secondary text-[10px] font-bold hover:text-[var(--text)] transition-colors">
              Completed (12)
            </button>
          </div>

          <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
            {[
              { title: 'Review business permit #8291', priority: 'High', time: '2h ago' },
              { title: 'Update system documentation', priority: 'Medium', time: '5h ago' },
              { title: 'Meeting with development team', priority: 'Low', time: 'Tomorrow' },
            ].map((task) => (
              <div
                key={task.title}
                className="flex items-center justify-between gap-2 p-3 rounded-xl transition-all group cursor-pointer min-w-0"
                style={{
                  backgroundColor: 'color-mix(in oklab, var(--surface-hover) 70%, transparent)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      task.priority === 'High'
                        ? 'bg-rose-500'
                        : task.priority === 'Medium'
                          ? 'bg-amber-500'
                          : 'bg-emerald-500',
                    )}
                  ></div>
                  <p
                    className="text-xs font-bold transition-colors truncate min-w-0"
                    style={{ color: 'var(--text)' }}
                  >
                    {task.title}
                  </p>
                </div>
                <span className="text-[10px] text-secondary shrink-0">{task.time}</span>
              </div>
            ))}
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder="Add a quick task..."
              className="w-full rounded-2xl pr-12 pl-4 py-2.5 text-xs focus:outline-none focus:ring-1 transition-all"
              style={{
                backgroundColor: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                color: 'var(--text)',
              }}
            />
            <button
              className="absolute inset-y-1 right-1 px-3 rounded-2xl transition-colors flex items-center justify-center"
              style={{ backgroundColor: 'var(--control-bg)' }}
            >
              <Plus size={14} style={{ color: 'var(--text)' }} />
            </button>
          </div>
        </div>

        {/* Calendar */}
        <div className="col-span-12 md:col-span-6 xl:col-span-3 glass-card p-4 sm:p-6 !border-transparent lg:-mt-18.5" style={{ backgroundColor: 'var(--surface)' }}>
          <h4
            className="text-sm font-bold mb-1"
            style={{ color: 'var(--text)' }}
          >
            Calendar
          </h4>
          <p className="text-[10px] text-secondary mb-4 sm:mb-6">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>

          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <button className="p-2 sm:p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-lg text-secondary hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors -ml-1">
              <ChevronLeft size={14} />
            </button>
            <span
              className="text-[11px] sm:text-xs font-bold text-center px-1"
              style={{ color: 'var(--text)' }}
            >
              {currentTime.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button className="p-2 sm:p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-lg text-secondary hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors -mr-1">
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-2 sm:gap-y-4 gap-x-0.5 sm:gap-x-0 text-center">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
              <span key={day} className="text-[9px] sm:text-[10px] font-bold text-secondary uppercase">
                {day}
              </span>
            ))}
            {Array.from({ length: startWeekday + daysInMonth }).map((_, i) => {
              const dayNum = i - startWeekday + 1;

              if (i < startWeekday) {
                return (
                  <div key={`empty-${i}`} className="flex items-center justify-center">
                    <span className="text-[10px]">&nbsp;</span>
                  </div>
                );
              }

              const isToday = dayNum === currentTime.getDate();

              return (
                <div key={dayNum} className="flex items-center justify-center">
                  <span
                    className={cn(
                      'text-[10px] font-bold w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all',
                      isToday
                        ? 'shadow-lg'
                        : 'text-secondary hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
                    )}
                    style={
                      isToday
                        ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                        : undefined
                    }
                  >
                    {dayNum}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Revenue Analytics */}
        <div
          className="col-span-12 xl:col-span-4 glass-card p-4 sm:p-6 !border-transparent"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <div className="flex justify-between items-start gap-2 mb-1 min-w-0">
            <h4
              className="text-sm font-bold truncate min-w-0"
              style={{ color: 'var(--text)' }}
            >
              Revenue Analytics
            </h4>
            <div className="flex items-center gap-1 text-[10px] font-bold text-secondary cursor-pointer hover:text-[var(--text)] transition-colors shrink-0">
              This Quarter <ChevronRight size={10} className="rotate-90" />
            </div>
          </div>
          <p className="text-[10px] text-secondary mb-4 sm:mb-6">Revenue breakdown by category</p>

          <div className="h-40 sm:h-48 w-full min-h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[
                  { name: 'Jan', value: 30 },
                  { name: 'Feb', value: 45 },
                  { name: 'Mar', value: 38 },
                  { name: 'Apr', value: 55 },
                ]}
              >
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primaryColor)" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="var(--primaryColor)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border-subtle)"
                  strokeOpacity={0.6}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--surface)',
                    border: `1px solid var(--border-subtle)`,
                    borderRadius: '12px',
                    fontSize: '10px',
                    color: 'var(--text)',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  }}
                  itemStyle={{ color: 'var(--text)' }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--primaryColor)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorValue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="flex justify-between mt-3 sm:mt-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Min</span>
              <span
                className="text-xs font-bold"
                style={{ color: 'var(--text)' }}
              >
                $30k
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Max</span>
              <span
                className="text-xs font-bold"
                style={{ color: 'var(--text)' }}
              >
                $60k
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

