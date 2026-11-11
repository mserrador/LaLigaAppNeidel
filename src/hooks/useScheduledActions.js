import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import scheduledActionsService from '../services/scheduledActionsService';

export const scheduledActionsKeys = {
  all: ['scheduledActions'],
  status: () => [...scheduledActionsKeys.all, 'status'],
  list: (filters) => [...scheduledActionsKeys.all, 'list', filters],
  detail: (id) => [...scheduledActionsKeys.all, 'detail', id],
  currentState: (id) => [...scheduledActionsKeys.all, 'currentState', id],
  exposure: () => [...scheduledActionsKeys.all, 'exposure'],
};

const useInvalidateScheduler = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: scheduledActionsKeys.all });
};

export const useSchedulerStatus = () => useQuery({
  queryKey: scheduledActionsKeys.status(),
  queryFn: scheduledActionsService.status,
  retry: false,
  refetchInterval: 60 * 1000,
  staleTime: 20 * 1000,
});

export const useScheduledActions = (filters = {}, enabled = true) => useQuery({
  queryKey: scheduledActionsKeys.list(filters),
  queryFn: () => scheduledActionsService.list(filters),
  enabled,
  refetchInterval: 30 * 1000,
  staleTime: 10 * 1000,
});

export const useScheduledExposure = (leagueId, schedulerConnected = true) => useQuery({
  queryKey: [...scheduledActionsKeys.exposure(), leagueId],
  queryFn: () => scheduledActionsService.exposure(leagueId),
  enabled: Boolean(leagueId && schedulerConnected),
  refetchInterval: 60 * 1000,
  staleTime: 20 * 1000,
});

export const useScheduledActionDetail = (id, open) => useQuery({
  queryKey: scheduledActionsKeys.detail(id),
  queryFn: () => scheduledActionsService.get(id),
  enabled: Boolean(id && open),
});

export const useScheduledActionCurrentState = (id, open) => useQuery({
  queryKey: scheduledActionsKeys.currentState(id),
  queryFn: () => scheduledActionsService.currentState(id),
  enabled: Boolean(id && open),
  staleTime: 0,
});

const useSchedulerMutation = (mutationFn) => {
  const invalidate = useInvalidateScheduler();
  return useMutation({ mutationFn, onSuccess: invalidate });
};

export const useConnectScheduler = () => useSchedulerMutation(scheduledActionsService.connect);
export const useDisconnectScheduler = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: scheduledActionsService.disconnect,
    onSuccess: async () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] === scheduledActionsKeys.all[0] && query.queryKey[1] !== 'status',
      });
      await queryClient.invalidateQueries({ queryKey: scheduledActionsKeys.status() });
    },
  });
};
export const useCreateScheduledAction = () => useSchedulerMutation(scheduledActionsService.create);
export const useUpdateScheduledAction = () => useSchedulerMutation(({ id, action }) => scheduledActionsService.update(id, action));
export const useToggleScheduledAction = () => useSchedulerMutation(({ id, enabled }) => scheduledActionsService.toggle(id, enabled));
export const useCancelScheduledAction = () => useSchedulerMutation(scheduledActionsService.cancel);
