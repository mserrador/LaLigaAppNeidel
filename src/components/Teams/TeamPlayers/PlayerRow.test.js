import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PlayerRow from './PlayerRow';

const renderPlayer = ({ isCurrentUserTeam = false, lockedUntil = null } = {}) => {
    const playerTeam = {
        playerTeamId: 'player-team-1',
        buyoutClause: 25000000,
        buyoutClauseLockedEndTime: lockedUntil,
        playerMaster: {
            id: 'player-1',
            name: 'Jugador de prueba',
            nickname: 'Jugador de prueba',
            positionId: 3,
            marketValue: 10000000,
            team: { name: 'Equipo de prueba' },
        },
    };

    return renderToStaticMarkup(
        <PlayerRow
            playerTeam={playerTeam}
            index={0}
            offerChangeKey={0}
            isCurrentUserTeam={isCurrentUserTeam}
            isPlayerInMarket={() => false}
            getMarketExpirationInfo={() => null}
            getPlayerTrendData={() => null}
            hasUserBid={() => false}
            onPlayerClick={() => {}}
            onShield={() => {}}
            onIncreaseBuyout={() => {}}
            onSellToMarket={() => {}}
            onWithdrawFromMarket={() => {}}
            onBid={() => {}}
            onCancelBid={() => {}}
            onPayClause={() => {}}
        />
    );
};

describe('PlayerRow clause action', () => {
    test('shows clause payment for an unprotected rival player', () => {
        expect(renderPlayer()).toContain('Pagar cláusula');
    });

    test('hides clause payment while the rival player is protected', () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        expect(renderPlayer({ lockedUntil: tomorrow })).not.toContain('Pagar cláusula');
    });

    test('hides clause payment for players owned by the current user', () => {
        expect(renderPlayer({ isCurrentUserTeam: true })).not.toContain('Pagar cláusula');
    });
});
