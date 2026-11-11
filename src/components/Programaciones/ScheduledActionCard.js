import React, { useEffect, useState } from 'react';
import { CalendarClock, Eye, Pause, Pencil, Play, Shield, Trash2 } from 'lucide-react';
import { formatCurrency, getPositionName } from '../../utils/helpers';
import { formatMadridDateTime, getCountdown } from '../../utils/schedulingDateTime';
import { buildRulesSummary } from './scheduledActionHelpers';

const STATUS = {
  pending: ['Pendiente', 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'],
  active: ['Activa', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'],
  disabled: ['Pausada', 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'],
  executed: ['Ejecutada', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'],
  skipped: ['No ejecutada', 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'],
  failed: ['Fallida', 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'],
  cancelled: ['Cancelada', 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'],
  scheduled: ['Programada', 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'],
  paused: ['Pausada', 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'],
  ready: ['Preparada', 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200'],
  executing: ['Ejecutando', 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200'],
  uncertain: ['Por verificar', 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'],
  expired: ['Expirada', 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'],
};

const getSnapshot = (action) => action?.playerSnapshot || action?.snapshot?.player || action?.snapshot || {};

const ScheduledActionCard = ({ action, history = false, onEdit, onToggle, onCancel, onDetail, busy }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (history) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [history]);

  const snapshot = getSnapshot(action);
  const config = action.config || {};
  const type = action.type === 'buyout' ? 'buyout' : 'bid';
  const statusKey = action.status || (action.enabled === false ? 'disabled' : 'active');
  const [statusLabel, statusClass] = STATUS[statusKey] || [statusKey, STATUS.pending[1]];
  const countdown = getCountdown(action.scheduledAt, new Date(now).toISOString());
  const maxAmount = action.maxAmount ?? config.maxAmount;
  const image = snapshot.image || snapshot.playerImage || snapshot.images?.transparent?.['256x256'];
  const name = snapshot.name || snapshot.playerName || 'Jugador';
  const canManage = !history && !['cancelled', 'executed', 'failed', 'skipped'].includes(statusKey);

  return (
    <article className="card overflow-hidden border border-gray-200 dark:border-gray-700">
      <div className={`h-1.5 ${type === 'buyout' ? 'bg-violet-500' : 'bg-primary-500'}`} />
      <div className="p-4 sm:p-5">
        <div className="flex gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-700">
            {image ? <img src={image} alt={name} className="h-full w-full object-contain" /> : (
              <div className="flex h-full items-center justify-center text-2xl font-bold text-gray-400">{name.charAt(0)}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${type === 'buyout' ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' : 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'}`}>
                    {type === 'buyout' ? 'Clausulazo' : 'Puja'}
                  </span>
                  <span className={`badge ${statusClass}`}>{statusLabel}</span>
                </div>
                <h3 className="mt-2 truncate text-lg font-bold text-gray-900 dark:text-white">{name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {getPositionName(snapshot.positionId, 'Posición N/D')}{snapshot.teamName ? ` · ${snapshot.teamName}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Máximo absoluto</p>
                <p className="font-bold text-gray-900 dark:text-white">{formatCurrency(maxAmount)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-900/50 sm:grid-cols-2">
          <div>
            <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"><CalendarClock className="h-3.5 w-3.5" /> Hora Madrid</p>
            <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{formatMadridDateTime(action.scheduledAt)}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Cuenta atrás</p>
            <p className={`mt-1 text-sm font-bold ${countdown.expired ? 'text-gray-500' : 'text-primary-600 dark:text-primary-400'}`}>{countdown.text}</p>
          </div>
        </div>

        <div className="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-300">
          {type === 'bid' ? (
            <p className="line-clamp-2"><strong>Reglas:</strong> {buildRulesSummary(config.rules || action.rules)}</p>
          ) : (
            <p><strong>Límites:</strong> total {formatCurrency(maxAmount)}{config.maxOverpriceEuros ? ` · sobreprecio ${formatCurrency(config.maxOverpriceEuros)}` : ''}{config.maxOverpricePercent ? ` · ${config.maxOverpricePercent}%` : ''}</p>
          )}
          {snapshot.ownerName && <p className="flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> Propietario al programar: {snapshot.ownerName}</p>}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => onDetail(action)}><Eye className="h-4 w-4" /> Detalle</button>
          {canManage && <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => onEdit(action)}><Pencil className="h-4 w-4" /> Editar</button>}
          {canManage && <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" disabled={busy} onClick={() => onToggle(action)}>
            {action.enabled === false ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} {action.enabled === false ? 'Activar' : 'Pausar'}
          </button>}
          {canManage && <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20" disabled={busy} onClick={() => onCancel(action)}><Trash2 className="h-4 w-4" /> Cancelar</button>}
        </div>
      </div>
    </article>
  );
};

export default ScheduledActionCard;
