import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import {
  buildLeagueExport,
  createLeagueExportFilename,
  downloadLeagueExport,
} from '../../utils/exportLeagueData';

const LeagueExportButton = () => {
  const queryClient = useQueryClient();
  const leagueId = useAuthStore((state) => state.leagueId);
  const leagueName = useAuthStore((state) => state.leagueName);
  const user = useAuthStore((state) => state.user);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (isExporting || !leagueId) return;

    setIsExporting(true);
    try {
      const data = await buildLeagueExport({ leagueId, leagueName, user, queryClient });
      downloadLeagueExport(data, createLeagueExportFilename(leagueId));

      if (data.errors.length) {
        toast.error(`Exportación parcial: ${data.errors.length} elemento(s) no pudieron recopilarse`);
      } else {
        toast.success('Exportación completada');
      }
    } catch (error) {
      console.error('Error exporting league:', error);
      toast.error(`Error al exportar la liga: ${error.message || 'error desconocido'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isExporting || !leagueId}
      className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      title="Descargar un JSON con todos los datos disponibles de la liga"
    >
      <Download className={`w-4 h-4 ${isExporting ? 'animate-pulse' : ''}`} aria-hidden="true" />
      <span>{isExporting ? 'Recopilando datos de la liga...' : 'Exportar liga completa'}</span>
    </button>
  );
};

export default LeagueExportButton;
