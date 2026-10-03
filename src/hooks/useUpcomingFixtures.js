import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fantasyAPI } from '../services/api';
import { useCurrentWeek } from './useCurrentWeek';
import {
  FIXTURE_WINDOW_DAYS,
  loadUpcomingFixtures,
} from '../utils/upcomingFixtures';

const useUpcomingFixtures = () => {
  const queryClient = useQueryClient();
  const { weekNumber, isLoading: isWeekLoading } = useCurrentWeek();

  const query = useQuery({
    queryKey: ['upcomingFixtures', weekNumber, FIXTURE_WINDOW_DAYS],
    enabled: !!weekNumber,
    retry: false,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const result = await loadUpcomingFixtures({
        weekNumber,
        fetchMatchday: (week) => queryClient.fetchQuery({
            queryKey: ['matches', week],
            queryFn: () => fantasyAPI.getMatchday(week),
            staleTime: 15 * 60 * 1000,
            gcTime: 60 * 60 * 1000,
          }),
      });
      return result.fixtures;
    },
  });

  return {
    ...query,
    fixtures: query.data || { byId: {}, byName: {} },
    isLoading: isWeekLoading || query.isLoading,
  };
};

export default useUpcomingFixtures;
