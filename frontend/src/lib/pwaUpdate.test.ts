import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  _resetPwaUpdateState, canApplyUpdateSilently, createPwaUpdateController,
  recordUserActivity, APP_VERSION, getPwaUpdateSnapshot, checkForPwaUpdate, applyWaitingPwaUpdate,
} from './pwaUpdate';

describe('pwaUpdate', () => {
  beforeEach(() => {
    _resetPwaUpdateState();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('allows silent updates only after 10 min of idle without active mutations', () => {
    vi.setSystemTime(1_000_000);
    recordUserActivity();

    expect(canApplyUpdateSilently({ hasActiveMutations: () => false })).toBe(false);

    vi.setSystemTime(1_000_000 + 9 * 60_000);
    expect(canApplyUpdateSilently({ hasActiveMutations: () => false })).toBe(false);

    vi.setSystemTime(1_000_000 + 10 * 60_000);
    expect(canApplyUpdateSilently({ hasActiveMutations: () => false })).toBe(true);

    // Active save in progress blocks silent reload even if idle
    expect(canApplyUpdateSilently({ hasActiveMutations: () => true })).toBe(false);
  });

  it('reloads immediately if idle when update becomes available', () => {
    vi.setSystemTime(1_000_000);
    recordUserActivity();
    vi.setSystemTime(1_000_000 + 11 * 60_000);

    const apply = vi.fn();
    const prompt = vi.fn();
    const ctrl = createPwaUpdateController({
      applyUpdate: apply,
      showPrompt: prompt,
      hasActiveMutations: () => false,
    });

    ctrl.onNeedRefresh();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('prompts if active when update arrives, and auto-applies once user goes idle', () => {
    vi.setSystemTime(1_000_000);
    recordUserActivity();

    const apply = vi.fn();
    const prompt = vi.fn();
    const ctrl = createPwaUpdateController({
      applyUpdate: apply,
      showPrompt: prompt,
      hasActiveMutations: () => false,
    });

    ctrl.onNeedRefresh();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();

    // Advance 10 min of silence → idle check fires apply
    vi.advanceTimersByTime(10 * 60_000);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('re-checks registration periodically while tab is open', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const reg = { update } as unknown as ServiceWorkerRegistration;
    const ctrl = createPwaUpdateController({
      applyUpdate: vi.fn(),
      showPrompt: vi.fn(),
      hasActiveMutations: () => false,
    });
    ctrl.onRegistered(reg);

    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('exposes appVersion and supports manual checkForPwaUpdate + applyWaitingPwaUpdate', async () => {
    expect(APP_VERSION).toBeTruthy();
    const apply = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const reg = { update, waiting: null } as unknown as ServiceWorkerRegistration;

    const ctrl = createPwaUpdateController({
      applyUpdate: apply,
      showPrompt: vi.fn(),
      hasActiveMutations: () => false,
    });
    ctrl.onRegistered(reg);

    const status = await checkForPwaUpdate();
    expect(status).toBe('up-to-date');
    expect(update).toHaveBeenCalledTimes(1);

    // Simulate update becoming available while user is active
    recordUserActivity();
    ctrl.onNeedRefresh();
    expect(getPwaUpdateSnapshot().updateAvailable).toBe(true);

    const applied = await applyWaitingPwaUpdate();
    expect(applied).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
