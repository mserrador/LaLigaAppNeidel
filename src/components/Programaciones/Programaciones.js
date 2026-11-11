import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, CalendarClock, Link2, Plus, Power, ShieldAlert, Unlink } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import EmptyState from '../Common/EmptyState';
import ErrorState from '../Common/ErrorState';
import LoadingSpinner from '../Common/LoadingSpinner';
import ScheduledActionCard from './ScheduledActionCard';
import ScheduledActionDetail from './ScheduledActionDetail';
import ScheduledActionForm from './ScheduledActionForm';
import { fantasyAPI } from '../../services/api';
import marketTrendsService from '../../services/marketTrendsService';
import { useAuthStore } from '../../stores/authStore';
import useMarketTrends from '../../hooks/useMarketTrends';
import {
  useCancelScheduledAction,
  useConnectScheduler,
  useCreateScheduledAction,
  useDisconnectScheduler,
  useScheduledActions,
  useScheduledExposure,
  useSchedulerStatus,
  useToggleScheduledAction,
  useUpdateScheduledAction,
} from '../../hooks/useScheduledActions';
import { extractArray, formatCurrency, readTeamMoney } from '../../utils/helpers';
import { extractTeamPlayers, fetchAllTeamsData } from '../../utils/fetchAllTeamsData';

const listFrom = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.actions)) return value.actions;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const teamOwnerName = (entry) => entry?.name || entry?.team?.name || entry?.team?.manager?.managerName || (typeof entry?.manager === 'string' ? entry.manager : null) || 'Desconocido';

const Programaciones = () => {
  const leagueId = useAuthStore((state) => state.leagueId);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('active');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formState, setFormState] = useState(null);
  const [detailAction, setDetailAction] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const filters = useMemo(() => ({
    scope: tab,
    ...(leagueId ? { leagueId } : {}),
    ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
    ...(tab === 'history' && statusFilter !== 'all' ? { status: statusFilter } : {}),
  }), [tab, typeFilter, statusFilter, leagueId]);
  const statusQuery = useSchedulerStatus();
  const schedulerStatus = statusQuery.data || {};
  const backendOnline = !statusQuery.isPending && !statusQuery.error && (schedulerStatus.running ?? schedulerStatus.available ?? true);
  const linked = Boolean(schedulerStatus.connected ?? schedulerStatus.credentialsLinked ?? schedulerStatus.hasCredentials);
  const actionsQuery = useScheduledActions(filters, linked);
  const exposureQuery = useScheduledExposure(leagueId, linked);
  const createMutation = useCreateScheduledAction();
  const updateMutation = useUpdateScheduledAction();
  const toggleMutation = useToggleScheduledAction();
  const cancelMutation = useCancelScheduledAction();
  const connectMutation = useConnectScheduler();
  const disconnectMutation = useDisconnectScheduler();
  const { trendsReady } = useMarketTrends();

  const standingsQuery = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => fantasyAPI.getLeagueRanking(leagueId),
    enabled: Boolean(leagueId),
    staleTime: 5 * 60 * 1000,
  });
  const standings = extractArray(standingsQuery.data);
  const currentUserId = user?.userId || user?.id;
  const myTeam = standings.find((entry) => {
    const managerId = entry.userId || entry.team?.userId || entry.team?.manager?.id;
    return managerId != null && currentUserId != null && String(managerId) === String(currentUserId);
  });
  const myTeamId = myTeam?.id || myTeam?.team?.id;
  const moneyQuery = useQuery({
    queryKey: ['teamMoney', myTeamId],
    queryFn: () => fantasyAPI.getTeamMoney(myTeamId),
    enabled: Boolean(myTeamId),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
  const currentCash = readTeamMoney(moneyQuery.data);

  const marketQuery = useQuery({
    queryKey: ['market', leagueId],
    queryFn: () => fantasyAPI.getMarket(leagueId),
    enabled: Boolean(leagueId && formState?.type === 'bid'),
    staleTime: 30 * 1000,
  });
  const rivalsQuery = useQuery({
    queryKey: ['scheduledActionRosters', leagueId],
    queryFn: () => fetchAllTeamsData(queryClient, leagueId, standings, {
      staleTime: 2 * 60 * 1000,
      shouldInclude: (entry, teamId) => String(teamId) !== String(myTeamId),
    }),
    enabled: Boolean(leagueId && myTeamId && standings.length && formState?.type === 'buyout'),
    staleTime: 2 * 60 * 1000,
  });

  const marketPlayers = useMemo(() => extractArray(marketQuery.data).map((entry) => {
    const player = entry.playerMaster;
    const playerTeamId = entry.playerTeam?.playerTeamId || entry.playerTeam?.id;
    if (!player?.id || !entry.id) return null;
    return {
      playerMasterId: player.id,
      marketId: entry.id,
      playerTeamId,
      name: player.nickname || player.name,
      positionId: player.positionId,
      teamName: player.team?.name,
      marketValue: player.marketValue || 0,
      image: player.images?.transparent?.['256x256'] || null,
      currentBids: entry.numberOfBids ?? (entry.bid ? 1 : 0),
      expirationDate: entry.expirationDate || null,
      trend: trendsReady ? marketTrendsService.resolveTrendForPlayer(player) : null,
    };
  }).filter(Boolean), [marketQuery.data, trendsReady]);

  const rivalPlayers = useMemo(() => {
    const result = [];
    if (!(rivalsQuery.data instanceof Map)) return result;
    for (const [ownerTeamId, { teamData, entry }] of rivalsQuery.data) {
      for (const playerTeam of extractTeamPlayers(teamData)) {
        const player = playerTeam.playerMaster;
        const playerTeamId = playerTeam.playerTeamId || playerTeam.id;
        if (!player?.id || !playerTeamId || !ownerTeamId || !playerTeam.buyoutClause) continue;
        result.push({
          playerMasterId: player.id,
          playerTeamId,
          ownerTeamId,
          name: player.nickname || player.name,
          positionId: player.positionId,
          teamName: player.team?.name,
          marketValue: player.marketValue || 0,
          clause: playerTeam.buyoutClause,
          ownerName: teamOwnerName(entry),
          points: player.points || 0,
          average: player.averagePoints ?? player.average ?? null,
          lockEnd: playerTeam.buyoutClauseLockedEndTime || null,
          image: player.images?.transparent?.['256x256'] || null,
          trend: trendsReady ? marketTrendsService.resolveTrendForPlayer(player) : null,
        });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [rivalsQuery.data, trendsReady]);

  const actions = listFrom(actionsQuery.data);
  const localActiveMax = actions.filter((action) => action.enabled !== false
    && ['scheduled', 'ready', 'executing', 'uncertain'].includes(action.status || 'scheduled'))
    .reduce((sum, action) => sum + Number(action.maxAmount ?? action.config?.maxAmount ?? 0), 0);
  const activeMaxSum = Number(exposureQuery.data?.activeMaxSum ?? exposureQuery.data?.totalMaxAmount ?? exposureQuery.data?.exposure ?? localActiveMax);
  const exceedsCash = typeof currentCash === 'number' && activeMaxSum > currentCash;
  const mutating = toggleMutation.isPending || cancelMutation.isPending;

  const submitForm = async (payload) => {
    try {
      const actionPayload = { ...payload, leagueId };
      if (formState.action) await updateMutation.mutateAsync({ id: formState.action.id, action: { ...actionPayload, version: formState.action.version } });
      else await createMutation.mutateAsync(actionPayload);
      toast.success(formState.action ? 'Programación actualizada' : 'Programación creada');
      setFormState(null);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'No se pudo guardar la programación');
    }
  };

  const toggleAction = async (action) => {
    try { await toggleMutation.mutateAsync({ id: action.id, enabled: action.enabled === false }); toast.success(action.enabled === false ? 'Programación activada' : 'Programación pausada'); }
    catch (error) { toast.error(error.response?.data?.message || error.message); }
  };
  const cancelAction = async (action) => {
    if (!window.confirm(`¿Cancelar la programación de ${action.playerSnapshot?.name || action.snapshot?.name || 'este jugador'}? Se conservará en el historial.`)) return;
    try { await cancelMutation.mutateAsync(action.id); toast.success('Programación cancelada y conservada en el historial'); }
    catch (error) { toast.error(error.response?.data?.message || error.message); }
  };
  const connect = async () => {
    const tokens = useAuthStore.getState().tokens;
    if (!tokens?.refresh_token) { toast.error('Tu sesión no contiene un refresh token. Vuelve a iniciar sesión para enlazarla.'); return; }
    try { await connectMutation.mutateAsync(tokens); toast.success('Credenciales enlazadas con el scheduler'); setConnectOpen(false); }
    catch (error) { toast.error(error.response?.data?.message || error.message); }
  };
  const disconnect = async () => {
    if (!window.confirm('¿Desconectar las credenciales del scheduler? Las programaciones no podrán ejecutarse.')) return;
    try { await disconnectMutation.mutateAsync(); toast.success('Scheduler desconectado'); }
    catch (error) { toast.error(error.response?.data?.message || error.message); }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-semibold uppercase tracking-widest text-primary-600">Automatización</p><h1 className="mt-1 text-3xl font-black tracking-tight text-gray-900 dark:text-white">Programaciones</h1><p className="mt-2 max-w-2xl text-gray-600 dark:text-gray-400">Define límites claros para que una puja o un clausulazo se intente en el momento elegido.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => linked ? setFormState({ type: 'buyout' }) : setConnectOpen(true)}><ShieldAlert className="h-4 w-4" /><Plus className="h-3 w-3" /> Clausulazo</button><button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => linked ? setFormState({ type: 'bid' }) : setConnectOpen(true)}><Plus className="h-4 w-4" /> Puja</button></div>
      </header>

      <section className={`rounded-2xl border p-4 ${backendOnline && linked ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-900/20' : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-900/20'}`}>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="flex gap-3"><div className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${backendOnline && linked ? 'bg-emerald-500' : 'bg-amber-500'}`} /><div><h2 className="font-bold text-gray-900 dark:text-white">{!backendOnline ? 'Backend del scheduler no disponible' : linked ? 'Scheduler conectado' : 'Credenciales no enlazadas'}</h2><p className="mt-1 text-sm text-gray-700 dark:text-gray-300">La ejecución requiere Docker/backend activo y que la máquina permanezca encendida en el momento programado.</p>{statusQuery.error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">No se pudo contactar con el backend: {statusQuery.error.message}</p>}</div></div>
          {linked ? <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-2" onClick={disconnect} disabled={disconnectMutation.isPending}><Unlink className="h-4 w-4" /> Desconectar</button> : <button type="button" className="btn-primary inline-flex shrink-0 items-center gap-2" onClick={() => setConnectOpen(true)} disabled={!backendOnline}><Link2 className="h-4 w-4" /> Enlazar credenciales</button>}
        </div>
      </section>

      <section className={`card border p-5 ${exceedsCash ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'}`}>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-sm font-medium text-gray-500 dark:text-gray-400">Exposición máxima de programaciones activas</p><p className="mt-1 text-3xl font-black text-gray-900 dark:text-white">{formatCurrency(activeMaxSum)}</p></div><div className="sm:text-right"><p className="text-sm text-gray-500 dark:text-gray-400">Saldo actual informado</p><p className="text-xl font-bold text-gray-900 dark:text-white">{typeof currentCash === 'number' ? formatCurrency(currentCash) : 'No disponible'}</p></div></div>
        {exceedsCash && <div className="mt-4 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200"><AlertTriangle className="h-5 w-5 shrink-0" /> La suma de máximos supera tu saldo actual. El scheduler podría omitir operaciones por falta de fondos.</div>}
      </section>

      <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800"><button type="button" onClick={() => setTab('active')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'active' ? 'bg-white text-primary-700 shadow-sm dark:bg-gray-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-300'}`}>Activas</button><button type="button" onClick={() => setTab('history')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'history' ? 'bg-white text-primary-700 shadow-sm dark:bg-gray-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-300'}`}>Historial</button></div><div className="flex gap-2"><select aria-label="Filtrar por tipo" className="input-field py-2" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos los tipos</option><option value="bid">Pujas</option><option value="buyout">Clausulazos</option></select>{tab === 'history' && <select aria-label="Filtrar por estado" className="input-field py-2" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option><option value="executed">Ejecutadas</option><option value="skipped">Omitidas</option><option value="failed">Fallidas</option><option value="cancelled">Canceladas</option></select>}</div></div>

      {actionsQuery.isLoading ? <LoadingSpinner label="Cargando programaciones..." /> : actionsQuery.error ? <ErrorState error={actionsQuery.error} onRetry={actionsQuery.refetch} title="No se pudieron cargar las programaciones" /> : actions.length === 0 ? <div className="card"><EmptyState icon={tab === 'active' ? CalendarClock : Bot} title={tab === 'active' ? 'No tienes programaciones activas' : 'El historial está vacío'} description={tab === 'active' ? 'Crea una puja o un clausulazo con límites económicos explícitos.' : 'Aquí aparecerán las ejecuciones, acciones no ejecutadas, fallos y cancelaciones.'} action={tab === 'active' ? <button type="button" className="btn-primary" onClick={() => linked ? setFormState({ type: 'bid' }) : setConnectOpen(true)}>Crear primera programación</button> : null} /></div> : <div className="grid gap-4 lg:grid-cols-2">{actions.map((action) => <ScheduledActionCard key={action.id} action={action} history={tab === 'history'} busy={mutating} onEdit={(item) => setFormState({ type: item.type, action: item })} onToggle={toggleAction} onCancel={cancelAction} onDetail={setDetailAction} />)}</div>}

      {formState && <ScheduledActionForm type={formState.type} action={formState.action} players={formState.type === 'bid' ? marketPlayers : rivalPlayers} playersLoading={formState.type === 'bid' ? marketQuery.isLoading : rivalsQuery.isLoading} onClose={() => setFormState(null)} onSubmit={submitForm} submitting={createMutation.isPending || updateMutation.isPending} />}
      <ScheduledActionDetail action={detailAction} onClose={() => setDetailAction(null)} />

      <Modal isOpen={connectOpen} onClose={() => setConnectOpen(false)} className="max-w-lg"><div className="p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-primary-100 p-3 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"><Power className="h-6 w-6" /></div><div><h2 className="text-xl font-bold text-gray-900 dark:text-white">Enlazar automatización</h2><p className="text-sm text-gray-500 dark:text-gray-400">Autoriza al backend para ejecutar en tu nombre.</p></div></div><div className="mt-4 space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100"><p>Se enviarán los tokens de tu sesión actual al backend. El refresh token se guardará cifrado.</p><p><strong>Cerrar sesión visualmente en la app no desconecta el scheduler.</strong> Usa siempre “Desconectar” en esta página para retirar las credenciales.</p><p>La máquina y Docker/backend deben seguir en ejecución.</p></div><div className="mt-5 flex justify-end gap-3"><button type="button" className="btn-secondary" onClick={() => setConnectOpen(false)}>Cancelar</button><button type="button" className="btn-primary inline-flex items-center gap-2" onClick={connect} disabled={connectMutation.isPending}><Link2 className="h-4 w-4" /> {connectMutation.isPending ? 'Enlazando...' : 'Enlazar ahora'}</button></div></div></Modal>
    </div>
  );
};

export default Programaciones;
