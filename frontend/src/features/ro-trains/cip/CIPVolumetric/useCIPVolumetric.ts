import { useState, useMemo } from 'react';
import type { VesselFlowMethod, VesselFlowRow } from '../VesselFlowCard';

export function useCIPVolumetric(numVessels = 4) {
  const [vesselCount, setVesselCount] = useState(numVessels);
  const [vesselCountInput, setVesselCountInput] = useState(String(numVessels));
  const [listGenerated, setListGenerated] = useState(false);
  const [vesselListOpen, setVesselListOpen] = useState(true);

  const makeRow = (id: number): VesselFlowRow => ({
    id, method: 'meter',
    prevMeter: '', currMeter: '', prevTime: '', currTime: '',
    bucketVol: '20', fillTimeSec: '',
  });
  const [vesselRows, setVesselRows] = useState<VesselFlowRow[]>(
    Array.from({ length: vesselCount }, (_, i) => makeRow(i + 1))
  );
  const [expandedVessel, setExpandedVessel] = useState<number | null>(null);
  const [globalMethod, setGlobalMethod] = useState<VesselFlowMethod>('meter');

  const [savedVessels, setSavedVessels] = useState<Set<number>>(new Set());
  const [editingVessel, setEditingVessel] = useState<number | null>(null);

  const generateList = () => {
    const n = Math.max(1, Math.min(50, +vesselCountInput || vesselCount));
    setVesselCount(n);
    setVesselRows(Array.from({ length: n }, (_, i) => makeRow(i + 1)));
    setListGenerated(true);
    setVesselListOpen(true);
    setSavedVessels(new Set());
    setEditingVessel(null);
  };

  const patchRow = (id: number, patch: Partial<VesselFlowRow>) =>
    setVesselRows(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r));

  const saveVessel = (id: number) => {
    setSavedVessels(prev => new Set([...prev, id]));
    setEditingVessel(null);
    setExpandedVessel(null);
  };
  const editVessel = (id: number) => {
    setSavedVessels(prev => { const n = new Set(prev); n.delete(id); return n; });
    setEditingVessel(id);
    setExpandedVessel(id);
  };
  const deleteVessel = (id: number) => {
    setVesselRows(rows => rows.filter(r => r.id !== id));
    setSavedVessels(prev => { const n = new Set(prev); n.delete(id); return n; });
    if (expandedVessel === id) setExpandedVessel(null);
  };

  const applyGlobalMethod = (m: VesselFlowMethod) => {
    setGlobalMethod(m);
    setVesselRows(rows => rows.map(r => ({ ...r, method: m })));
  };

  const [qPrevMeter, setQPrevMeter] = useState('');
  const [qCurrMeter, setQCurrMeter] = useState('');
  const [qPrevTime,  setQPrevTime]  = useState('');
  const [qCurrTime,  setQCurrTime]  = useState('');

  const [preCipVol,  setPreCipVol]  = useState('');
  const [postCipVol, setPostCipVol] = useState('');
  const [preCipTds,  setPreCipTds]  = useState('');
  const [postCipTds, setPostCipTds] = useState('');
  const [preCipKpi,  setPreCipKpi]  = useState('');
  const [postCipKpi, setPostCipKpi] = useState('');

  const [activeTab, setActiveTab] = useState<'vessel' | 'flow' | 'compare'>('vessel');

  const deltaV = (qCurrMeter !== '' && qPrevMeter !== '')
    ? +((+qCurrMeter) - (+qPrevMeter)).toFixed(4) : null;
  const deltaT_hr = useMemo(() => {
    if (!qPrevTime || !qCurrTime) return null;
    const diff = (new Date(qCurrTime).getTime() - new Date(qPrevTime).getTime()) / 3600000;
    return diff > 0 ? +diff.toFixed(4) : null;
  }, [qPrevTime, qCurrTime]);
  const flowQ = (deltaV !== null && deltaT_hr !== null && deltaT_hr > 0)
    ? +((deltaV) / deltaT_hr).toFixed(4) : null;

  const deltaVolRecovery = (postCipVol !== '' && preCipVol !== '')
    ? +((+postCipVol) - (+preCipVol)).toFixed(4) : null;
  const deltaTds = (postCipTds !== '' && preCipTds !== '')
    ? +((+postCipTds) - (+preCipTds)).toFixed(2) : null;
  const deltaKpi = (postCipKpi !== '' && preCipKpi !== '')
    ? +((+postCipKpi) - (+preCipKpi)).toFixed(2) : null;

  const deltaColor = (val: number | null, lowerIsBetter = false) => {
    if (val === null) return 'text-muted-foreground';
    const good = lowerIsBetter ? val < 0 : val > 0;
    return good ? 'text-accent' : val === 0 ? 'text-muted-foreground' : 'text-danger';
  };
  const deltaSign = (val: number | null) => val === null ? '—' : val > 0 ? `+${val}` : `${val}`;

  const TABS = [
    { key: 'vessel',  label: 'Per-Vessel Flow' },
    { key: 'flow',    label: 'Flow Q=ΔV/Δt'    },
    { key: 'compare', label: 'Comparative'      },
  ] as const;

  return {
    vesselCount, vesselCountInput, setVesselCountInput, listGenerated, setListGenerated, vesselListOpen, setVesselListOpen,
    vesselRows, expandedVessel, setExpandedVessel, globalMethod, applyGlobalMethod,
    generateList, patchRow,
    savedVessels, editingVessel, saveVessel, editVessel, deleteVessel,
    qPrevMeter, setQPrevMeter, qCurrMeter, setQCurrMeter, qPrevTime, setQPrevTime, qCurrTime, setQCurrTime,
    preCipVol, setPreCipVol, postCipVol, setPostCipVol, preCipTds, setPreCipTds, postCipTds, setPostCipTds,
    preCipKpi, setPreCipKpi, postCipKpi, setPostCipKpi,
    activeTab, setActiveTab,
    deltaV, deltaT_hr, flowQ,
    deltaVolRecovery, deltaTds, deltaKpi,
    deltaColor, deltaSign, TABS,
  };
}
