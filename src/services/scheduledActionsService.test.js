import api from './api';
import scheduledActionsService from './scheduledActionsService';

jest.mock('./api', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

describe('scheduledActionsService.create', () => {
  beforeEach(() => {
    api.post.mockReset();
  });

  it('keeps a newly created disabled action paused', async () => {
    api.post.mockResolvedValue({
      data: { id: 'action-1', status: 'paused' },
    });

    const result = await scheduledActionsService.create({
      type: 'buyout',
      leagueId: 'league-1',
      playerMasterId: 'player-1',
      scheduledAt: '2026-11-12T12:00:00.000Z',
      enabled: false,
      config: {},
    });

    expect(result.enabled).toBe(false);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/scheduler/actions', expect.objectContaining({ enabled: false }));
  });
});
