import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from '../../utils/motionShim';
import { Users, Search, User, Trophy, ChevronRight, Target, RefreshCw, Wallet, ChevronDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { fantasyAPI } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, formatNumber, setImageFallback, extractArray } from '../../utils/helpers';
import LoadingSpinner from '../Common/LoadingSpinner';
import ErrorDisplay from '../Common/ErrorDisplay';
import useMarketTrends from '../../hooks/useMarketTrends';
import useTeamMarketIncreases from '../../hooks/useTeamMarketIncreases';
import useLeagueFinances from '../../hooks/useLeagueFinances';

const Teams = () => {
  const leagueId = useAuthStore((state) => state.leagueId);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFinanceTeamId, setExpandedFinanceTeamId] = useState(null);

  // Handle URL search parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const searchParam = urlParams.get('search');
    if (searchParam) {
      setSearchTerm(decodeURIComponent(searchParam));
    }
  }, [location.search]);

  const { data: standings, isLoading, error, refetch } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => fantasyAPI.getLeagueRanking(leagueId),
    enabled: !!leagueId,
    retry: false,
    staleTime: 1 * 60 * 1000, // 1 minuto - equipos pueden cambiar con transacciones
    gcTime: 5 * 60 * 1000, // 5 minutos en memoria
  });

  // Market trends via el hook compartido (una query key para toda la app)
  const { trendsReady: trendsInitialized } = useMarketTrends();

  // Team market value increases via the shared hook
  const teamMarketIncreases = useTeamMarketIncreases(standings, leagueId, trendsInitialized);
  const {
    finances,
    data: financeData,
    isLoading: financesLoading,
    isFetching: financesFetching,
    refetch: refetchFinances,
  } = useLeagueFinances(standings, leagueId, user, queryClient);

  if (isLoading) return <LoadingSpinner fullScreen={true} />;

  if (error) {
    return <ErrorDisplay
      error={error}
      title="Error al cargar los equipos"
      onRetry={refetch}
      fullScreen={true}
    />;
  }

  // Handle different API response structures
  const teamsData = extractArray(standings);

  // Filter teams by search term
  const filteredTeams = teamsData.filter(item => {
    const teamName = item.name || item.team?.name || '';
    const managerName = item.manager || item.team?.manager?.managerName || '';
    const searchLower = searchTerm.toLowerCase();

    return teamName.toLowerCase().includes(searchLower) ||
           managerName.toLowerCase().includes(searchLower);
  });

  const getTeamName = (item) => {
    return item.name || item.team?.name || 'Equipo';
  };

  

  const getTeamPoints = (item) => {
    return item.points || item.team?.points || 0;
  };

  const getTeamValue = (item) => {
    return item.teamValue || item.team?.teamValue || 0;
  };

  const getUserId = (item) => {
    return item.userId || item.team?.userId || item.team?.manager?.id;
  };

  const getUserName = (item) => {
    // Priority order for display names
    return item.manager ||
           item.team?.manager?.managerName ||
           item.managerName ||
           item.userName ||
           item.user?.name ||
           'Usuario';
  };

  const isCurrentUser = (item) => {
    const itemUserId = getUserId(item);
    return itemUserId && user?.userId && itemUserId.toString() === user.userId.toString();
  };

  const getTeamId = (item) => {
    return item.id || item.team?.id;
  };

  const getTeamMarketIncrease = (item) => {
    const teamId = getTeamId(item);
    return teamMarketIncreases.get(teamId) || 0;
  };

  const formatMarketChange = (change) => {
    if (!change || change === 0) return '0€';
    const formattedValue = Math.abs(change).toLocaleString('es-ES');
    return change > 0 ? `+${formattedValue}€` : `-${formattedValue}€`;
  };

  const formatCash = (value) => (
    typeof value === 'number' ? `${value.toLocaleString('es-ES')}€` : 'No disponible'
  );

  const confidenceLabel = {
    official: 'Oficial',
    high: 'Alta confianza',
    medium: 'Estimado',
    low: 'Baja confianza',
    incomplete: 'Incompleto',
  };

  const confidenceClass = {
    official: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    high: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    incomplete: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-500 rounded-full flex items-center justify-center">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name || user.username}
                  className="w-10 h-10 rounded-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    setImageFallback(e.target.parentNode, {
                      tag: 'span',
                      className: 'text-white text-lg font-bold',
                      text: (user?.name || user?.username || 'U').charAt(0),
                    });
                  }}
                />
              ) : (
                <span className="text-white text-lg font-bold">
                  {(user?.name || user?.username || 'U').charAt(0)}
                </span>
              )}
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Equipos
            </h1>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {filteredTeams.length} equipos en la liga
          </p>
          {(financesLoading || financesFetching) && (
            <p className="text-sm text-primary-600 dark:text-primary-400 mt-1">
              Reconstruyendo movimientos y saldos...
            </p>
          )}
          {financeData && !financesFetching && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {financeData.historyComplete ? 'Historial completo' : 'Historial parcial'} · {financeData.pagesLoaded} páginas · {financeData.snapshotCount} snapshots
            </p>
          )}
        </div>
        <button
            onClick={async () => {
              await queryClient.invalidateQueries({ queryKey: ['standings', leagueId] });
              await queryClient.invalidateQueries({ queryKey: ['teamData'] });
              await queryClient.invalidateQueries({ queryKey: ['leagueFinances', leagueId] });
              await Promise.all([refetch(), refetchFinances()]);
          }}
          className="btn-primary flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {/* Search */}
      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar equipo o manager..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field pl-10"
          />
        </div>
      </div>

      {/* Teams List */}
      <div className="card divide-y divide-gray-200 dark:divide-dark-border">
        {filteredTeams.map((item, index) => {
          const teamId = getTeamId(item);
          const isUser = isCurrentUser(item);
          const position = item.position || index + 1;
          const finance = finances.get(String(teamId));
          const financeExpanded = expandedFinanceTeamId === String(teamId);

          return (
            <motion.div
              key={teamId || index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`p-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                isUser ? 'bg-primary-50 dark:bg-primary-900/10 border-l-4 border-primary-500' : ''
              }`}
            >
              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 overflow-hidden">
                {/* Team Info */}
                <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
                  {/* Position */}
                  <div className="flex items-center gap-1 min-w-[60px] xl:min-w-[80px] flex-shrink-0">
                    {position <= 3 && (
                      <Trophy className="w-4 h-4 xl:w-5 xl:h-5 text-yellow-500" />
                    )}
                    <span className={`text-base xl:text-lg font-bold px-2 xl:px-3 py-1 rounded-full ${
                      position <= 3
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      #{position}
                    </span>
                  </div>

                  {/* Manager Avatar & Info */}
                  <div className="flex items-center gap-2 xl:gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gradient-to-br from-primary-400 to-primary-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-base xl:text-lg font-bold">
                        {getUserName(item).charAt(0)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base xl:text-xl font-semibold text-gray-900 dark:text-white truncate">
                          {getUserName(item)}
                        </h3>
                        {isUser && (
                          <span className="badge bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400 flex-shrink-0">
                            Tú
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 truncate">
                        <User className="w-3 h-3 xl:w-4 xl:h-4 flex-shrink-0" />
                        <span className="truncate">{getTeamName(item)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats - Responsive Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:flex xl:items-center gap-4 xl:gap-8 text-center xl:text-left overflow-hidden">
                  <div className="min-w-0">
                    <p className="text-xs xl:text-sm text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">
                      Puntos
                    </p>
                    <p className="text-lg xl:text-2xl font-bold text-gray-900 dark:text-white truncate">
                      {formatNumber(getTeamPoints(item))}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs xl:text-sm text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">
                      Valor
                    </p>
                    <p className="text-sm xl:text-lg font-semibold text-gray-900 dark:text-white truncate">
                      {formatCurrency(getTeamValue(item))}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs xl:text-sm text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">
                      Subida 24h
                    </p>
                    <p className={`text-sm font-medium truncate ${
                      getTeamMarketIncrease(item) > 0
                        ? 'text-green-600 dark:text-green-400'
                        : getTeamMarketIncrease(item) < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      {formatMarketChange(getTeamMarketIncrease(item))}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedFinanceTeamId(financeExpanded ? null : String(teamId))}
                    className="min-w-0 rounded-lg px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                    aria-expanded={financeExpanded}
                    aria-label={`Ver desglose financiero de ${getUserName(item)}`}
                  >
                    <p className="text-xs xl:text-sm text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-center xl:justify-start gap-1">
                      <Wallet className="w-3.5 h-3.5" />
                      Líquido
                    </p>
                    <p className="text-sm xl:text-lg font-semibold text-gray-900 dark:text-white truncate">
                      {finance ? formatCash(finance.cash) : (financesLoading ? 'Calculando...' : 'No disponible')}
                    </p>
                    {finance && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${confidenceClass[finance.confidence]}`}>
                        {confidenceLabel[finance.confidence]}
                        <ChevronDown className={`w-3 h-3 transition-transform ${financeExpanded ? 'rotate-180' : ''}`} />
                      </span>
                    )}
                  </button>
                </div>

                {/* Actions - Desktop */}
                <div className="hidden md:flex items-center gap-3">
                  <Link
                    to={`/teams/${teamId}/lineup`}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Target className="w-4 h-4" />
                    <span className="hidden lg:inline">Alineación</span>
                  </Link>
                  <Link
                    to={`/teams/${teamId}/players`}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Users className="w-4 h-4" />
                    <span className="hidden lg:inline">Jugadores</span>
                  </Link>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              </div>

              {financeExpanded && finance && (
                <div className="mt-5 pt-5 border-t border-gray-200 dark:border-dark-border">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
                    {[
                      ['Saldo inicial', finance.breakdown.initialCash, 'text-gray-900 dark:text-white'],
                      ['Premios', finance.breakdown.earnings, 'text-green-600 dark:text-green-400'],
                      ['Ventas', finance.breakdown.sales, 'text-green-600 dark:text-green-400'],
                      ['Cláusulas cobradas', finance.breakdown.buyoutsReceived, 'text-green-600 dark:text-green-400'],
                      ['Compras', -finance.breakdown.purchases, 'text-red-600 dark:text-red-400'],
                      ['Clausulazos', -finance.breakdown.buyoutsPaid, 'text-red-600 dark:text-red-400'],
                      ['Subidas exactas', -finance.breakdown.clauseInvestmentsExact, 'text-red-600 dark:text-red-400'],
                      ['Subidas observadas', -finance.breakdown.clauseInvestmentsObserved, 'text-red-600 dark:text-red-400'],
                      ['Subidas estimadas', -finance.breakdown.clauseInvestmentsEstimated, 'text-orange-600 dark:text-orange-400'],
                      ['Ajuste no explicado', finance.breakdown.unexplainedAdjustment, 'text-gray-600 dark:text-gray-400'],
                    ].map(([label, value, color]) => (
                      <div key={label} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 min-w-0">
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={label}>{label}</p>
                        <p className={`font-semibold truncate ${color}`}>{formatCash(value)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>Calculado: {formatCash(finance.calculatedCash)}</span>
                    {finance.knownDeviation != null && finance.confidence !== 'official' && (
                      <span>· Margen conocido: ±{formatCash(finance.knownDeviation)}</span>
                    )}
                    {finance.minimumCash != null && finance.maximumCash != null && finance.confidence !== 'official' && (
                      <span>· Rango: {formatCash(finance.minimumCash)} a {formatCash(finance.maximumCash)}</span>
                    )}
                    {finance.confidence === 'official' && (
                      <span>· Desviación del cálculo: {formatCash(finance.knownDeviation)}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Mobile Actions - Big Touch-Friendly Buttons */}
              <div className="md:hidden mt-4 pt-4 border-t border-gray-200 dark:border-dark-border">
                <div className="grid grid-cols-2 gap-3">
                  <Link
                    to={`/teams/${teamId}/lineup`}
                    className="btn-primary flex items-center justify-center gap-2 py-3 text-base font-semibold"
                  >
                    <Target className="w-5 h-5" />
                    <span>Alineación</span>
                  </Link>
                  <Link
                    to={`/teams/${teamId}/players`}
                    className="btn-secondary flex items-center justify-center gap-2 py-3 text-base font-semibold"
                  >
                    <Users className="w-5 h-5" />
                    <span>Jugadores</span>
                  </Link>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {filteredTeams.length === 0 && (
        <div className="card p-12 text-center">
          <Users className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No se encontraron equipos
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {searchTerm ? 'Intenta ajustar tu búsqueda' : 'Los equipos se cargarán cuando estén disponibles'}
          </p>
        </div>
      )}
    </div>
  );
};

export default Teams;
