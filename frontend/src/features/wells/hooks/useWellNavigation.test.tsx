import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useWellNavigation } from './useWellNavigation';

let seenPath = '';
let seenSearch = '';
function Probe() {
  const l = useLocation();
  seenPath = l.pathname;
  seenSearch = l.search;
  return null;
}
function Buttons() {
  const { openWell, backToWells } = useWellNavigation('p1');
  const nav = useNavigate();
  return (
    <>
      <button onClick={() => openWell('w7')}>open</button>
      <button onClick={backToWells}>back-to-wells</button>
      {/* stands in for the browser Back button */}
      <button onClick={() => nav(-1)}>browser-back</button>
      <Probe />
    </>
  );
}
function App({ entries, index }: { entries: string[]; index?: number }) {
  return (
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route path="/plants/:id" element={<Buttons />} />
        <Route path="/plants/:id/wells/:wellId" element={<Buttons />} />
        <Route path="/elsewhere" element={<Buttons />} />
      </Routes>
    </MemoryRouter>
  );
}
const click = (name: string) => fireEvent.click(screen.getByText(name));

describe('useWellNavigation (P5-3)', () => {
  it('openWell goes to /plants/:id/wells/:wellId', () => {
    render(<App entries={['/plants/p1?tab=wells']} />);
    click('open');
    expect(seenPath).toBe('/plants/p1/wells/w7');
  });

  it('browser Back from a well returns to the wells list, not out of the plant (the bug this fixes)', () => {
    render(<App entries={['/elsewhere', '/plants/p1?tab=wells']} index={1} />);
    click('open');
    expect(seenPath).toBe('/plants/p1/wells/w7');
    click('browser-back');
    expect(seenPath).toBe('/plants/p1');
    expect(seenSearch).toBe('?tab=wells');
  });

  it('"Back to Wells" after opening from the list pops history rather than pushing a new entry', () => {
    render(<App entries={['/elsewhere', '/plants/p1?tab=wells']} index={1} />);
    click('open');
    click('back-to-wells');
    expect(seenPath).toBe('/plants/p1');
    expect(seenSearch).toBe('?tab=wells');
    // Had it pushed, one browser-back would land on the well again.
    click('browser-back');
    expect(seenPath).toBe('/elsewhere');
  });

  it('deep link: "Back to Wells" goes to the list URL', () => {
    render(<App entries={['/elsewhere', '/plants/p1/wells/w7']} index={1} />);
    click('back-to-wells');
    expect(seenPath).toBe('/plants/p1');
    expect(seenSearch).toBe('?tab=wells');
  });

  it('deep link: "Back to Wells" replaces the well entry, so the well is not a Back-button trap', () => {
    render(<App entries={['/elsewhere', '/plants/p1/wells/w7']} index={1} />);
    click('back-to-wells');
    click('browser-back');
    // replaced, not pushed: the previous entry is what the user came from
    expect(seenPath).toBe('/elsewhere');
  });
});
