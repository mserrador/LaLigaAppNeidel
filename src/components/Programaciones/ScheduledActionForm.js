import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, Shield, TrendingDown, TrendingUp, X } from 'lucide-react';
import Modal from '../Common/Modal';
import LoadingSpinner from '../Common/LoadingSpinner';
import { createMoneyInputHandler } from '../../utils/moneyInput';
import { formatCurrency, formatNumberWithDots, getPositionName } from '../../utils/helpers';
import { formatMadridDateTime, utcIsoToMadridLocal } from '../../utils/schedulingDateTime';
import { buildRulesSummary, RULE_COUNTS, validateBidForm, validateBuyoutForm } from './scheduledActionHelpers';

const defaultRules = () => RULE_COUNTS.map(() => ({ calculationType: 'market_value', value: '' }));
const futureLocal = () => utcIsoToMadridLocal(new Date(Date.now() + 10 * 60 * 1000).toISOString());

const MoneyInput = ({ value, setValue, id, placeholder = '0' }) => (
  <div className="relative"><input id={id} className="input-field pr-8" inputMode="numeric" value={formatNumberWithDots(value)} onChange={createMoneyInputHandler(setValue)} placeholder={placeholder} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">€</span></div>
);

const FieldError = ({ children }) => children ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{children}</p> : null;

const Trend = ({ trend }) => {
  if (!trend) return <span className="text-gray-400">Tendencia N/D</span>;
  const change = trend.diferencia1 ?? trend.change ?? 0;
  return <span className={`inline-flex items-center gap-1 ${change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}{change >= 0 ? '+' : ''}{formatCurrency(change)}</span>;
};

const PlayerPreview = ({ player, type }) => {
  if (!player) return null;
  return (
    <div className="mt-3 flex gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white dark:bg-gray-700">{player.image ? <img src={player.image} alt={player.name} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-xl font-bold text-gray-400">{player.name?.charAt(0)}</div>}</div>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold text-gray-900 dark:text-white">{player.name}</p>
        <p className="text-gray-500 dark:text-gray-400">{getPositionName(player.positionId)} · VM {formatCurrency(player.marketValue)}</p>
        <p className="mt-1"><Trend trend={player.trend} /></p>
        {type === 'bid' ? <p className="mt-1 text-gray-600 dark:text-gray-300">{player.currentBids || 0} pujas · expira {formatMadridDateTime(player.expirationDate)}</p> : <p className="mt-1 text-gray-600 dark:text-gray-300">{player.ownerName} · cláusula {formatCurrency(player.clause)} · sobreprecio {formatCurrency(Math.max(0, (player.clause || 0) - (player.marketValue || 0)))}</p>}
        {type === 'buyout' && <p className="text-gray-500 dark:text-gray-400">{player.points || 0} pts · media {player.average ?? 'N/D'} · desbloqueo {formatMadridDateTime(player.lockEnd, 'Ya disponible')}</p>}
      </div>
    </div>
  );
};

const ScheduledActionForm = ({ type, action, players = [], playersLoading, onClose, onSubmit, submitting }) => {
  const config = action?.config || {};
  const originalSnapshot = action?.playerSnapshot || action?.snapshot?.player || action?.snapshot;
  const originalPlayer = action ? {
    ...originalSnapshot,
    playerMasterId: action.playerMasterId || originalSnapshot?.playerMasterId,
    marketId: action.marketId || originalSnapshot?.marketId,
    playerTeamId: action.playerTeamId || originalSnapshot?.playerTeamId,
    ownerTeamId: action.ownerTeamId || originalSnapshot?.ownerTeamId,
    lockEnd: originalSnapshot?.lockEnd,
  } : null;
  const [selectedId, setSelectedId] = useState(action?.playerMasterId ? String(action.playerMasterId) : '');
  const [selectedPlayer, setSelectedPlayer] = useState(originalPlayer);
  const [confirming, setConfirming] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    timingMode: config.timingMode || (type === 'buyout' ? 'unlock' : 'exact'),
    scheduledLocal: utcIsoToMadridLocal(action?.scheduledAt) || futureLocal(),
    offsetAmount: config.offsetAmount ?? '30',
    offsetUnit: config.offsetUnit || 'seconds',
    maxAmount: String(action?.maxAmount ?? config.maxAmount ?? ''),
    maxOverpriceEuros: String(config.maxOverpriceEuros ?? ''),
    maxOverpricePercent: String(config.maxOverpricePercent ?? ''),
    rules: config.rules?.length === 4 ? config.rules.map((rule) => ({ ...rule, value: String(rule.value ?? '') })) : defaultRules(),
    enabled: action?.enabled !== false,
  });

  useEffect(() => {
    const candidate = players.find((player) => String(player.playerMasterId) === selectedId);
    if (candidate) setSelectedPlayer(candidate);
  }, [players, selectedId]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setRule = (index, key, value) => setForm((current) => ({
    ...current,
    rules: current.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, [key]: value } : rule),
  }));

  const validate = () => type === 'bid'
    ? validateBidForm(form, selectedPlayer)
    : validateBuyoutForm(form, selectedPlayer);

  const continueToConfirm = (event) => {
    event.preventDefault();
    const result = validate();
    setErrors(result.errors);
    if (result.valid) setConfirming(true);
  };

  const submit = async () => {
    const result = validate();
    setErrors(result.errors);
    if (!result.valid) { setConfirming(false); return; }
    const snapshot = {
      playerMasterId: selectedPlayer.playerMasterId,
      playerTeamId: selectedPlayer.playerTeamId,
      name: selectedPlayer.name,
      image: selectedPlayer.image,
      positionId: selectedPlayer.positionId,
      teamName: selectedPlayer.teamName,
      marketValue: selectedPlayer.marketValue,
      ownerName: selectedPlayer.ownerName || null,
      clause: selectedPlayer.clause || null,
      lockEnd: selectedPlayer.lockEnd || null,
      observedAt: new Date().toISOString(),
    };
    const payload = {
      type,
      playerMasterId: selectedPlayer.playerMasterId,
      playerTeamId: selectedPlayer.playerTeamId,
      ...(type === 'bid' ? { marketId: selectedPlayer.marketId } : { ownerTeamId: selectedPlayer.ownerTeamId }),
      scheduledAt: result.scheduledAt,
      maxAmount: Number(form.maxAmount),
      enabled: form.enabled,
      playerSnapshot: snapshot,
      config: type === 'bid' ? {
        timingMode: form.timingMode,
        offsetAmount: form.timingMode === 'offset' ? Number(form.offsetAmount) : null,
        offsetUnit: form.offsetUnit,
        expirationObservedAt: selectedPlayer.expirationDate,
        rules: form.rules.map((rule) => ({ ...rule, value: rule.calculationType === 'market_value' ? 0 : Number(rule.value) })),
      } : {
        timingMode: form.timingMode,
        observedLockEnd: selectedPlayer.lockEnd || null,
        maxOverpriceEuros: form.maxOverpriceEuros ? Number(form.maxOverpriceEuros) : null,
        maxOverpricePercent: form.maxOverpricePercent ? Number(form.maxOverpricePercent) : null,
      },
    };
    await onSubmit(payload);
  };

  return (
    <Modal isOpen onClose={onClose} className="max-w-3xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-primary-600">{action ? 'Editar' : 'Nueva'} programación</p><h2 className="text-xl font-bold text-gray-900 dark:text-white">{type === 'buyout' ? 'Clausulazo' : 'Puja automática'}</h2></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Cerrar"><X className="h-5 w-5" /></button>
      </div>

      {confirming ? (
        <div className="space-y-5 p-5">
          <div className="flex items-center gap-3 rounded-xl bg-amber-50 p-4 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100"><CheckCircle2 className="h-6 w-6 shrink-0" /><p><strong>Revisa antes de confirmar.</strong> El scheduler podrá ejecutar esta operación sin otra intervención.</p></div>
          <PlayerPreview player={selectedPlayer} type={type} />
          <dl className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-900/50">
            <div className="flex justify-between gap-4"><dt>Se ejecutará</dt><dd className="font-semibold">{formatMadridDateTime(validate().scheduledAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt>Máximo absoluto</dt><dd className="font-semibold">{formatCurrency(form.maxAmount)}</dd></div>
            <div className="flex justify-between gap-4"><dt>Estado inicial</dt><dd className="font-semibold">{form.enabled ? 'Activa' : 'Pausada'}</dd></div>
            {type === 'bid' && <div><dt>Reglas de competencia</dt><dd className="mt-1 font-semibold">{buildRulesSummary(form.rules)}</dd></div>}
            {type === 'buyout' && <div className="flex justify-between gap-4"><dt>Límites de sobreprecio</dt><dd className="font-semibold">{form.maxOverpriceEuros ? formatCurrency(form.maxOverpriceEuros) : 'Sin límite en euros'} · {form.maxOverpricePercent ? `${form.maxOverpricePercent}%` : 'sin límite porcentual'}</dd></div>}
          </dl>
          <div className="flex justify-end gap-3"><button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setConfirming(false)} disabled={submitting}><ArrowLeft className="h-4 w-4" /> Volver</button><button type="button" className="btn-primary" onClick={submit} disabled={submitting}>{submitting ? 'Guardando...' : action ? 'Confirmar cambios' : 'Crear programación'}</button></div>
        </div>
      ) : (
        <form onSubmit={continueToConfirm} className="space-y-5 p-5">
          <section><label htmlFor="scheduled-player" className="block text-sm font-semibold text-gray-800 dark:text-gray-100">Jugador</label>
            {playersLoading ? <LoadingSpinner size="small" label="Cargando jugadores..." /> : <select id="scheduled-player" className="input-field mt-1" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={Boolean(action)}><option value="">Selecciona un jugador</option>{players.map((player) => <option key={`${player.playerMasterId}-${player.playerTeamId}`} value={String(player.playerMasterId)}>{player.name} · {formatCurrency(type === 'buyout' ? player.clause : player.marketValue)}</option>)}</select>}
            <FieldError>{errors.player}</FieldError><PlayerPreview player={selectedPlayer} type={type} />
          </section>

          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700"><h3 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white"><Clock className="h-4 w-4" /> Momento de ejecución</h3>
            {type === 'bid' ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={`cursor-pointer rounded-lg border p-3 ${form.timingMode === 'exact' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700'}`}><input type="radio" name="timing" value="exact" checked={form.timingMode === 'exact'} onChange={() => update('timingMode', 'exact')} /> <span className="ml-2 font-medium">Fecha y hora exactas</span></label><label className={`cursor-pointer rounded-lg border p-3 ${form.timingMode === 'offset' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700'}`}><input type="radio" name="timing" value="offset" checked={form.timingMode === 'offset'} onChange={() => update('timingMode', 'offset')} disabled={!selectedPlayer?.expirationDate} /> <span className="ml-2 font-medium">Antes de expirar</span></label></div> : <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={`cursor-pointer rounded-lg border p-3 ${form.timingMode === 'unlock' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700'}`}><input type="radio" name="timing" checked={form.timingMode === 'unlock'} onChange={() => update('timingMode', 'unlock')} disabled={!selectedPlayer?.lockEnd} /> <span className="ml-2 font-medium">Al desbloquear (recomendado)</span></label><label className={`cursor-pointer rounded-lg border p-3 ${form.timingMode === 'manual' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700'}`}><input type="radio" name="timing" checked={form.timingMode === 'manual'} onChange={() => update('timingMode', 'manual')} /> <span className="ml-2 font-medium">Hora manual</span></label></div>}
            {(form.timingMode === 'exact' || form.timingMode === 'manual') && <div className="mt-3"><label htmlFor="scheduled-at" className="text-sm text-gray-600 dark:text-gray-300">Hora local de Madrid</label><input id="scheduled-at" type="datetime-local" step="1" className="input-field mt-1" value={form.scheduledLocal} onChange={(event) => update('scheduledLocal', event.target.value)} /></div>}
            {form.timingMode === 'offset' && <div className="mt-3 flex gap-2"><input aria-label="Margen" type="number" min="0" className="input-field" value={form.offsetAmount} onChange={(event) => update('offsetAmount', event.target.value)} /><select aria-label="Unidad del margen" className="input-field" value={form.offsetUnit} onChange={(event) => update('offsetUnit', event.target.value)}><option value="seconds">segundos antes</option><option value="minutes">minutos antes</option></select></div>}
            {form.timingMode === 'unlock' && <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">Bloqueo observado: <strong>{formatMadridDateTime(selectedPlayer?.lockEnd, 'No disponible')}</strong></p>}
            <FieldError>{errors.schedule}</FieldError>
          </section>

          {type === 'bid' && <section><h3 className="font-bold text-gray-900 dark:text-white">Reglas según pujas rivales</h3><div className="mt-2 space-y-2">{form.rules.map((rule, index) => <div key={RULE_COUNTS[index]} className="grid grid-cols-[70px_1fr] gap-2 sm:grid-cols-[85px_1fr_1fr]"><span className="self-center text-sm font-semibold">{RULE_COUNTS[index]} pujas</span><select aria-label={`Cálculo para ${RULE_COUNTS[index]} pujas`} className="input-field" value={rule.calculationType} onChange={(event) => setRule(index, 'calculationType', event.target.value)}><option value="market_value">Valor de mercado</option><option value="market_value_plus">VM + euros</option><option value="fixed">Importe fijo</option><option value="market_value_percent">VM + porcentaje</option></select>{rule.calculationType !== 'market_value' && <input aria-label={`Valor para ${RULE_COUNTS[index]} pujas`} type="number" min="0" className="input-field col-start-2 sm:col-start-auto" value={rule.value} onChange={(event) => setRule(index, 'value', event.target.value)} placeholder={rule.calculationType === 'market_value_percent' ? '%' : '€'} />}</div>)}</div><p className="mt-2 text-xs text-gray-500">{buildRulesSummary(form.rules)}</p><FieldError>{errors.rules}</FieldError></section>}

          <section className="rounded-xl bg-gray-50 p-4 dark:bg-gray-900/50"><h3 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white"><Shield className="h-4 w-4" /> Límites económicos</h3><label htmlFor="max-amount" className="mt-3 block text-sm font-medium">Máximo total absoluto *</label><MoneyInput id="max-amount" value={form.maxAmount} setValue={(value) => update('maxAmount', value)} /><FieldError>{errors.maxAmount}</FieldError>
            {type === 'buyout' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><label htmlFor="max-overprice" className="text-sm font-medium">Sobreprecio máximo en euros</label><MoneyInput id="max-overprice" value={form.maxOverpriceEuros} setValue={(value) => update('maxOverpriceEuros', value)} /><FieldError>{errors.maxOverpriceEuros}</FieldError></div><div><label htmlFor="max-percent" className="text-sm font-medium">Sobreprecio máximo porcentual</label><div className="relative"><input id="max-percent" type="number" min="0" step="0.1" className="input-field pr-8" value={form.maxOverpricePercent} onChange={(event) => update('maxOverpricePercent', event.target.value)} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span></div><FieldError>{errors.maxOverpricePercent}</FieldError></div></div>}
          </section>

          <label className="flex items-center justify-between rounded-xl border border-gray-200 p-4 dark:border-gray-700"><span><strong className="block text-gray-900 dark:text-white">Activar al guardar</strong><span className="text-sm text-gray-500">Si la pausas, no se ejecutará hasta que la actives.</span></span><input type="checkbox" className="h-5 w-5" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /></label>
          <div className="flex justify-end gap-3"><button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="btn-primary">Revisar programación</button></div>
        </form>
      )}
    </Modal>
  );
};

export default ScheduledActionForm;
