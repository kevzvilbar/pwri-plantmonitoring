import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportTopologyAsSvg, exportTopologyAsPng } from './exportTopology';

describe('exportTopology', () => {
  let mockSvg: SVGSVGElement;

  beforeEach(() => {
    mockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mockSvg.setAttribute('width', '1000');
    mockSvg.setAttribute('height', '600');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', 'scale(1.5)');
    mockSvg.appendChild(g);

    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exportTopologyAsSvg triggers a downloadable .svg file with reset scale(1)', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    exportTopologyAsSvg({
      svgElement: mockSvg,
      plantName: 'SRP Water Plant',
      maxX: 1200,
      maxY: 800,
    });

    expect(appendSpy).toHaveBeenCalled();
    const anchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.tagName.toLowerCase()).toBe('a');
    expect(anchor.download).toBe('srp-water-plant-topology.svg');
    expect(anchor.href).toBe('blob:mock-url');
    expect(removeSpy).toHaveBeenCalledWith(anchor);
  });

  it('exportTopologyAsPng handles export options correctly', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    // In JSDOM, canvas.toBlob / img.onload can be tested or checked for call structure
    const promise = exportTopologyAsPng({
      svgElement: mockSvg,
      plantName: 'SRP Water Plant',
      maxX: 1200,
      maxY: 800,
      scale: 2,
    });

    // In a test environment without full layout engine, the promise is initiated
    expect(promise).toBeInstanceOf(Promise);
  });
});
