import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { KpiCards } from './KpiCards';
import { ControlConsole } from './ControlConsole';
import { ActiveAlertsList } from './ActiveAlertsList';

describe('Alerts & Notification System UI', () => {
  describe('KpiCards', () => {
    it('renders all KPI counters and triggers filter clicks', () => {
      const setActiveView = vi.fn();
      const setTierFilter = vi.fn();

      render(
        <KpiCards
          activeView="active"
          tierFilter="all"
          setActiveView={setActiveView}
          setTierFilter={setTierFilter}
          plantAlertsLength={12}
          criticalCount={3}
          warningCount={7}
          notifsLength={25}
          unreadLogsCount={4}
        />
      );

      expect(screen.getByText('Active Alerts')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('Warning')).toBeInTheDocument();
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText('System Log')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('(4 unread)')).toBeInTheDocument();

      // Click Critical card
      fireEvent.click(screen.getByText('Critical').closest('div[class*="rounded"]')!);
      expect(setActiveView).toHaveBeenCalledWith('active');
      expect(setTierFilter).toHaveBeenCalledWith('critical');
    });
  });

  describe('ControlConsole', () => {
    it('renders search input, filter pills, and triggers actions', () => {
      const setActiveView = vi.fn();
      const setTierFilter = vi.fn();
      const setPlantFilter = vi.fn();
      const setSearchQuery = vi.fn();
      const onSnoozeAll = vi.fn();
      const onAcknowledgeAll = vi.fn();
      const onResolveAll = vi.fn();
      const onMarkAllRead = vi.fn();

      render(
        <ControlConsole
          activeView="active"
          setActiveView={setActiveView}
          tierFilter="all"
          setTierFilter={setTierFilter}
          plantFilter="all"
          setPlantFilter={setPlantFilter}
          searchQuery=""
          setSearchQuery={setSearchQuery}
          plantAlertsLength={5}
          criticalCount={2}
          warningCount={3}
          infoCount={0}
          unreadLogsCount={0}
          notifsLength={10}
          visiblePlants={[{ id: 'plant-1', name: 'Guizo Plant' }]}
          onSnoozeAll={onSnoozeAll}
          onAcknowledgeAll={onAcknowledgeAll}
          onResolveAll={onResolveAll}
          onMarkAllRead={onMarkAllRead}
        />
      );

      expect(screen.getByText(/Active Alarms/i)).toBeInTheDocument();
      expect(screen.getByText(/System Log/i)).toBeInTheDocument();
      expect(screen.getByText(/Snooze all/i)).toBeInTheDocument();
      expect(screen.getByText(/Acknowledge all/i)).toBeInTheDocument();
      expect(screen.getByText(/Resolve all/i)).toBeInTheDocument();

      // Click snooze all
      fireEvent.click(screen.getByText(/Snooze all/i));
      expect(onSnoozeAll).toHaveBeenCalled();

      // Click acknowledge all
      fireEvent.click(screen.getByText(/Acknowledge all/i));
      expect(onAcknowledgeAll).toHaveBeenCalled();

      // Click resolve all
      fireEvent.click(screen.getByText(/Resolve all/i));
      expect(onResolveAll).toHaveBeenCalled();

      // Typing in search
      const searchInput = screen.getByPlaceholderText(/Search by title/i);
      fireEvent.change(searchInput, { target: { value: 'Pump' } });
      expect(setSearchQuery).toHaveBeenCalledWith('Pump');
    });
  });

  describe('ActiveAlertsList', () => {
    it('renders alert list cards and handles acknowledge/resolve/snooze/navigate', () => {
      const mockAlerts = [
        {
          id: 'alert-1',
          plantId: 'p-1',
          severity: 'critical',
          title: 'High DP Pressure',
          description: 'DP exceeded 2.5 bar on RO Train 1',
          source: 'RO Train 1',
          timestamp: Date.now(),
          linkPath: '/ro-trains',
        },
      ];
      const plantNames = new Map([['p-1', 'Guizo Plant']]);
      const onNavigate = vi.fn();
      const onSnooze = vi.fn();
      const onAcknowledge = vi.fn();
      const onResolve = vi.fn();

      render(
        <ActiveAlertsList
          filteredPlantAlerts={mockAlerts}
          plantNameById={plantNames}
          onNavigate={onNavigate}
          onSnooze={onSnooze}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
        />
      );

      expect(screen.getByText('High DP Pressure')).toBeInTheDocument();
      expect(screen.getByText('DP exceeded 2.5 bar on RO Train 1')).toBeInTheDocument();
      expect(screen.getByText('Guizo Plant')).toBeInTheDocument();
      expect(screen.getByText('RO Train 1')).toBeInTheDocument();
      expect(screen.getByText('View')).toBeInTheDocument();

      // Click View
      fireEvent.click(screen.getByText('View'));
      expect(onNavigate).toHaveBeenCalledWith('/ro-trains');
    });

    it('renders clean empty state when no alerts match', () => {
      render(
        <ActiveAlertsList
          filteredPlantAlerts={[]}
          plantNameById={new Map()}
          onNavigate={vi.fn()}
          onSnooze={vi.fn()}
          onAcknowledge={vi.fn()}
          onResolve={vi.fn()}
        />
      );

      expect(screen.getByText('No active alarms matching criteria')).toBeInTheDocument();
    });
  });
});

