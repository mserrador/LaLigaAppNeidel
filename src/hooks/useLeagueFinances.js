import { useQuery } from '@tanstack/react-query';
import { extractArray } from '../utils/helpers';
import { loadLeagueFinances } from '../services/leagueFinanceService';

const EMPTY_MAP = new Map();

const useLeagueFinances = (standings, leagueId, user, queryClient) => {
  const standingsCount = extractArray(standings).length;
  const query = useQuery({
    queryKey: ['leagueFinances', leagueId, standingsCount],
    queryFn: () => loadLeagueFinances({ leagueId, standings, user, queryClient }),
    enabled: !!leagueId && standingsCount > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  return {
    ...query,
    finances: query.data?.finances || EMPTY_MAP,
  };
};

export default useLeagueFinances;
