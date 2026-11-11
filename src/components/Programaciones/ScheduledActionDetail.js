import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import Modal from '../Common/Modal';
import LoadingSpinner from '../Common/LoadingSpinner';
import ErrorState from '../Common/ErrorState';
import { formatCurrency } from '../../utils/helpers';
import { formatMadridDateTime } from '../../utils/schedulingDateTime';
import { useScheduledActionCurrentState, useScheduledActionDetail } from '../../hooks/useScheduledActions';
import { buildRulesSummary } from './scheduledActionHelpers';

const Row = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2.5 last:border-0 dark:border-gray-700">
    <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
    <dd className="text-right text-sm font-medium text-gray-900 dark:text-white">{children ?? 'N/D'}</dd>
  </div>
);

const ScheduledActionDetail = ({ action, onClose }) => {
  const id = action?.id;
  const detailQuery = useScheduledActionDetail(id, Boolean(action));
  const liveQuery = useScheduledActionCurrentState(id, Boolean(action));
  const detail = detailQuery.data || action || {};
  const config = detail.config || {};
  const snapshot = detail.playerSnapshot || detail.snapshot?.player || detail.snapshot || {};
  const live = liveQuery.data || {};
  const attempt = detail.executionAttempt || detail.attempt || detail.execution || {};
  const executionSnapshot = attempt.snapshot || {};

  return (
    <Modal isOpen={Boolean(action)} onClose={onClose} className="max-w-3xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-primary-600">Detalle de programación</p><h2 className="text-xl font-bold text-gray-900 dark:text-white">{snapshot.name || snapshot.playerName || 'Acción programada'}</h2></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Cerrar"><X className="h-5 w-5" /></button>
      </div>
      <div className="space-y-5 p-5">
        {detailQuery.isLoading ? <LoadingSpinner size="small" label="Cargando detalle..." /> : detailQuery.error ? <ErrorState error={detailQuery.error} onRetry={detailQuery.refetch} /> : (
          <>
            <section><h3 className="font-bold text-gray-900 dark:text-white">Configuración original</h3><dl className="mt-2 rounded-xl bg-gray-50 px-4 dark:bg-gray-900/50">
              <Row label="Tipo">{detail.type === 'buyout' ? 'Clausulazo' : 'Puja'}</Row>
              <Row label="Creada">{formatMadridDateTime(detail.createdAt)}</Row>
              <Row label="Programada (Madrid)">{formatMadridDateTime(detail.scheduledAt)}</Row>
              <Row label="Máximo absoluto">{formatCurrency(detail.maxAmount ?? config.maxAmount)}</Row>
              {detail.type === 'bid' && <Row label="Reglas"><span className="max-w-md inline-block">{buildRulesSummary(config.rules || detail.rules)}</span></Row>}
              {detail.type === 'buyout' && <Row label="Sobreprecio máximo">{config.maxOverpriceEuros ? formatCurrency(config.maxOverpriceEuros) : 'Sin límite adicional'}{config.maxOverpricePercent ? ` / ${config.maxOverpricePercent}%` : ''}</Row>}
              <Row label="IDs">master {detail.playerMasterId || snapshot.playerMasterId} · playerTeam {detail.playerTeamId || snapshot.playerTeamId}{detail.marketId ? ` · mercado ${detail.marketId}` : ''}{detail.ownerTeamId ? ` · propietario ${detail.ownerTeamId}` : ''}</Row>
              <Row label="Snapshot propietario">{snapshot.ownerName || 'Sin propietario'}</Row>
              <Row label="Snapshot VM">{formatCurrency(snapshot.marketValue)}</Row>
              {snapshot.clause != null && <Row label="Snapshot cláusula">{formatCurrency(snapshot.clause)}</Row>}
              {snapshot.lockEnd && <Row label="Candado observado">{formatMadridDateTime(snapshot.lockEnd)}</Row>}
            </dl></section>

            <section><div className="flex items-center justify-between"><h3 className="font-bold text-gray-900 dark:text-white">Estado actual</h3><button type="button" onClick={() => liveQuery.refetch()} className="text-primary-600" aria-label="Actualizar estado"><RefreshCw className={`h-4 w-4 ${liveQuery.isFetching ? 'animate-spin' : ''}`} /></button></div>
              {liveQuery.isLoading ? <LoadingSpinner size="small" label="Consultando estado actual..." /> : liveQuery.error ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">No se pudo obtener el estado actual: {liveQuery.error.message}</p> : <dl className="mt-2 rounded-xl bg-gray-50 px-4 dark:bg-gray-900/50">
                <Row label="Valor de mercado">{formatCurrency(live.marketValue)}</Row>
                <Row label={detail.type === 'buyout' ? 'Cláusula actual' : 'Pujas actuales'}>{detail.type === 'buyout' ? formatCurrency(live.clause ?? live.buyoutClause) : (live.numberOfBids ?? live.currentBids ?? 0)}</Row>
                {detail.type === 'buyout' && live.marketValue != null && (live.clause ?? live.buyoutClause) != null && (
                  <Row label="Sobreprecio actual">{formatCurrency((live.clause ?? live.buyoutClause) - live.marketValue)}</Row>
                )}
                <Row label="Propietario actual">{live.ownerName || 'Sin propietario'}</Row>
                <Row label="Saldo actual">{live.balance != null ? formatCurrency(live.balance) : 'N/D'}</Row>
                <Row label="Actualizado">{formatMadridDateTime(live.observedAt || live.updatedAt)}</Row>
              </dl>}
            </section>

            <section><h3 className="font-bold text-gray-900 dark:text-white">Intento de ejecución</h3><dl className="mt-2 rounded-xl bg-gray-50 px-4 dark:bg-gray-900/50">
              <Row label="Momento">{formatMadridDateTime(attempt.attemptedAt || attempt.executedAt)}</Row>
              <Row label="Resultado">{attempt.result || detail.status || 'Aún no ejecutada'}</Row>
              <Row label="VM utilizado">{executionSnapshot.marketValue != null ? formatCurrency(executionSnapshot.marketValue) : 'N/D'}</Row>
              {executionSnapshot.numberOfBids != null && <Row label="Número de pujas utilizado">{executionSnapshot.numberOfBids}</Row>}
              {executionSnapshot.buyoutAmount != null && <Row label="Cláusula utilizada">{formatCurrency(executionSnapshot.buyoutAmount)}</Row>}
              {executionSnapshot.overprice != null && <Row label="Sobreprecio">{formatCurrency(executionSnapshot.overprice)}</Row>}
              <Row label="Importe">{attempt.amount != null ? formatCurrency(attempt.amount) : 'N/D'}</Row>
              {executionSnapshot.balanceBefore != null && <Row label="Saldo antes">{formatCurrency(executionSnapshot.balanceBefore)}</Row>}
              {executionSnapshot.balanceAfter != null && <Row label="Saldo después">{formatCurrency(executionSnapshot.balanceAfter)}</Row>}
              {executionSnapshot.selectedRule && <Row label="Regla seleccionada">{executionSnapshot.selectedRule.calcType}</Row>}
              <Row label="Motivo">{attempt.reason || detail.reason || 'N/D'}</Row>
            </dl></section>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ScheduledActionDetail;
