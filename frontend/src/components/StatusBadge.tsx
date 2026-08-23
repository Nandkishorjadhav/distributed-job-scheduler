import React from 'react';
import clsx from 'clsx';

interface StatusBadgeProps {
  status: string;
  type?: 'job' | 'worker' | 'queue' | 'dlq';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'job', className }) => {
  const normalized = (status || '').toLowerCase();

  let colorClasses = 'bg-gray-800 text-gray-300 border-gray-700';

  if (type === 'job') {
    switch (normalized) {
      case 'completed':
        colorClasses = 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60';
        break;
      case 'running':
        colorClasses = 'bg-blue-950/80 text-blue-400 border-blue-800/60 animate-pulse';
        break;
      case 'pending':
        colorClasses = 'bg-amber-950/80 text-amber-400 border-amber-800/60';
        break;
      case 'scheduled':
      case 'delayed':
        colorClasses = 'bg-purple-950/80 text-purple-400 border-purple-800/60';
        break;
      case 'failed':
        colorClasses = 'bg-orange-950/80 text-orange-400 border-orange-800/60';
        break;
      case 'dead':
        colorClasses = 'bg-rose-950/80 text-rose-400 border-rose-800/60';
        break;
      case 'cancelled':
        colorClasses = 'bg-gray-800/80 text-gray-400 border-gray-700/60';
        break;
    }
  } else if (type === 'worker') {
    switch (normalized) {
      case 'online':
      case 'active':
        colorClasses = 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60';
        break;
      case 'busy':
        colorClasses = 'bg-amber-950/80 text-amber-400 border-amber-800/60';
        break;
      case 'unhealthy':
        colorClasses = 'bg-rose-950/80 text-rose-400 border-rose-800/60 animate-pulse';
        break;
      case 'stopped':
      case 'offline':
      case 'draining':
        colorClasses = 'bg-gray-800/80 text-gray-400 border-gray-700/60';
        break;
    }
  } else if (type === 'queue') {
    switch (normalized) {
      case 'active':
        colorClasses = 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60';
        break;
      case 'paused':
        colorClasses = 'bg-amber-950/80 text-amber-400 border-amber-800/60';
        break;
      case 'archived':
        colorClasses = 'bg-gray-800/80 text-gray-400 border-gray-700/60';
        break;
    }
  } else if (type === 'dlq') {
    switch (normalized) {
      case 'unhandled':
        colorClasses = 'bg-rose-950/80 text-rose-400 border-rose-800/60';
        break;
      case 'retried':
        colorClasses = 'bg-blue-950/80 text-blue-400 border-blue-800/60';
        break;
      case 'archived':
        colorClasses = 'bg-gray-800/80 text-gray-400 border-gray-700/60';
        break;
    }
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border',
        colorClasses,
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-80"></span>
      {status}
    </span>
  );
};
