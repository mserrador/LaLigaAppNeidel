import { formatCurrency } from '../../utils/helpers';
import { madridLocalToUtcIso, subtractOffsetFromIso } from '../../utils/schedulingDateTime';

export const RULE_COUNTS = ['0', '1', '2', '3+'];

export const calculationLabel = (rule) => {
  const value = Number(rule?.value || 0);
  switch (rule?.calculationType) {
    case 'market_value': return 'valor de mercado';
    case 'market_value_plus': return `VM + ${formatCurrency(value)}`;
    case 'fixed': return formatCurrency(value);
    case 'market_value_percent': return `VM + ${value}%`;
    default: return 'sin definir';
  }
};

export const buildRulesSummary = (rules = []) => RULE_COUNTS.map((count, index) => {
  const rule = rules[index] || {};
  return `${count} pujas: ${calculationLabel(rule)}`;
}).join(' · ');

export const resolveBidScheduledAt = ({ timingMode, scheduledLocal, expirationDate, offsetAmount, offsetUnit }) => (
  timingMode === 'offset'
    ? subtractOffsetFromIso(expirationDate, offsetAmount, offsetUnit)
    : madridLocalToUtcIso(scheduledLocal)
);

export const validateBidForm = (form, player, now = Date.now()) => {
  const errors = {};
  if (!player?.playerMasterId || !player?.marketId) errors.player = 'Selecciona un jugador válido del mercado.';
  const scheduledAt = resolveBidScheduledAt({ ...form, expirationDate: player?.expirationDate });
  if (!scheduledAt || new Date(scheduledAt).getTime() <= now) errors.schedule = 'La ejecución debe quedar programada en el futuro.';
  if (form.timingMode === 'offset' && !(Number(form.offsetAmount) >= 0)) errors.schedule = 'Indica un margen válido.';
  if (!(Number(form.maxAmount) > 0)) errors.maxAmount = 'El máximo absoluto es obligatorio.';
  if (!Array.isArray(form.rules) || form.rules.length !== 4 || form.rules.some((rule) => (
    !['market_value', 'market_value_plus', 'fixed', 'market_value_percent'].includes(rule.calculationType)
    || (rule.calculationType !== 'market_value' && !(Number(rule.value) > 0))
  ))) errors.rules = 'Configura correctamente las cuatro reglas.';
  return { errors, scheduledAt, valid: Object.keys(errors).length === 0 };
};

export const validateBuyoutForm = (form, player, now = Date.now()) => {
  const errors = {};
  if (!player?.playerMasterId || !player?.playerTeamId || !player?.ownerTeamId) errors.player = 'Selecciona un jugador rival válido.';
  const scheduledAt = form.timingMode === 'unlock' ? player?.lockEnd : madridLocalToUtcIso(form.scheduledLocal);
  const lockTime = player?.lockEnd ? new Date(player.lockEnd).getTime() : 0;
  if (!scheduledAt || new Date(scheduledAt).getTime() <= now) errors.schedule = 'La ejecución debe quedar programada en el futuro.';
  if (form.timingMode === 'manual' && lockTime && new Date(scheduledAt).getTime() < lockTime) errors.schedule = 'La hora manual no puede ser anterior al desbloqueo observado.';
  if (!(Number(form.maxAmount) > 0)) errors.maxAmount = 'El máximo total absoluto es obligatorio.';
  if (form.maxOverpriceEuros && !(Number(form.maxOverpriceEuros) > 0)) errors.maxOverpriceEuros = 'El límite en euros debe ser positivo.';
  if (form.maxOverpricePercent && !(Number(form.maxOverpricePercent) > 0)) errors.maxOverpricePercent = 'El porcentaje debe ser positivo.';
  return { errors, scheduledAt, valid: Object.keys(errors).length === 0 };
};
