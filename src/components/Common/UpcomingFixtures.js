import React from 'react';
import { Calendar } from 'lucide-react';
import TeamBadge from './TeamBadge';
import { FIXTURE_WINDOW_DAYS } from '../../utils/upcomingFixtures';

const formatFixtureDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
};

const UpcomingFixtures = ({ fixtures = [], isLoading = false }) => (
  <div className="pt-3 border-t border-gray-200 dark:border-dark-border">
    <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-2">
      <Calendar className="w-4 h-4" aria-hidden="true" />
      Próximos {FIXTURE_WINDOW_DAYS} días
    </div>

    {fixtures.length > 0 ? (
      <div className="space-y-1.5">
        {fixtures.map((fixture, index) => {
          const opponent = fixture.opponent;
          const opponentName = opponent?.name || opponent?.shortName || opponent?.teamName || 'Por definir';
          const fixtureDate = formatFixtureDate(fixture.date);
          return (
            <div
              key={`${fixture.week}-${opponent?.id || opponentName}-${index}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 whitespace-nowrap">
                J{fixture.week}{fixtureDate ? ` · ${fixtureDate}` : ''} · {fixture.isHome ? 'vs' : 'en'}
              </span>
              <span className="flex items-center justify-end gap-1.5 min-w-0 font-medium text-gray-900 dark:text-white">
                <TeamBadge team={opponent} className="w-4 h-4" />
                <span className="truncate" title={opponentName}>{opponentName}</span>
              </span>
            </div>
          );
        })}
      </div>
    ) : (
      <span className="text-xs text-gray-400 dark:text-gray-500">
        {isLoading ? 'Cargando calendario...' : 'Sin partidos programados'}
      </span>
    )}
  </div>
);

export default React.memo(UpcomingFixtures);
