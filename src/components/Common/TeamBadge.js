import React from 'react';

export const getTeamBadgeUrl = (team) => (
  team?.badgeColor
  || team?.badge
  || team?.shield
  || team?.logo
  || team?.image
  || null
);

const TeamBadge = ({ team, className = 'w-5 h-5', alt }) => {
  const src = getTeamBadgeUrl(team);
  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt || `Escudo del ${team?.name || 'equipo'}`}
      className={`${className} object-contain flex-shrink-0`}
      onError={(event) => { event.currentTarget.style.display = 'none'; }}
    />
  );
};

export default TeamBadge;
