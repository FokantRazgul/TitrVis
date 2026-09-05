import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The 3D scene and Plotly cannot run in jsdom; both are replaced by inert stand-ins.
vi.mock('../rendering/Scene', () => ({ Scene: () => <div data-testid="scene-stub" /> }));
vi.mock('./plotly', () => ({
  Plot: (props: { data: unknown[]; divId?: string }) => <div data-testid="plot-stub" id={props.divId} data-traces={props.data.length} />,
  Plotly: { toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') },
}));
vi.mock('../utils/screenshot', () => ({ downloadScreenshot: vi.fn(async () => true) }));
vi.mock('../utils/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/export')>();
  return { ...actual, downloadText: vi.fn(() => true) };
});
vi.mock('./MoleculeStructure', () => ({ MoleculeStructure: ({ name }: { name: string }) => <svg data-testid="structure-svg" aria-label={`Structure of ${name}`} /> }));

import { App } from '../app/App';
import { DEFAULT_CONFIG, useExperimentStore } from '../state/experimentStore';
import { downloadText } from '../utils/export';
import { downloadScreenshot } from '../utils/screenshot';
import { MobileControls } from './MobileControls';
import { NumberField } from './NumberField';

// jsdom has no WebGL2: force the WebGL2 detection to succeed so the full app renders.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ getParameter: () => 'WebGL 2.0', getExtension: () => null, VERSION: 0x1f02 }) as never);

beforeEach(() => {
  useExperimentStore.setState({ ...DEFAULT_CONFIG, toasts: [], theme: 'light', panelsVisible: true, lightingMode: 1, indicatorPanelOpen: false, muted: false });
  useExperimentStore.getState().reset();
  window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) as never);
});

describe('App shell', () => {
  it('renders panels, scene and measurements', async () => {
    render(<App />);
    expect(await screen.findByTestId('scene-stub')).toBeInTheDocument();
    expect(screen.getByTestId('experiment-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ph-value')).toHaveTextContent('2.88');
    expect(screen.getByTestId('equivalence-list')).toHaveTextContent('50.000 mL');
  });

  it('searches and selects substances', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId('analyte-search'), 'citric');
    expect(screen.getByTestId('analyte-card-citric_acid')).toBeInTheDocument();
    expect(screen.queryByTestId('analyte-card-acetic_acid')).toBeNull();
    await user.click(screen.getByTestId('analyte-card-citric_acid'));
    expect(useExperimentStore.getState().analyteId).toBe('citric_acid');
    expect(screen.getByTestId('analyte-selected')).toHaveTextContent('Citric acid');
    await user.type(screen.getByTestId('titrant-search'), 'Ca(OH)2');
    await user.click(screen.getByTestId('titrant-card-calcium_hydroxide'));
    expect(useExperimentStore.getState().titrantId).toBe('calcium_hydroxide');
    // 3 equivalence points for citric acid vs Ca(OH)2 (2 equivalents): 25, 50, 75 mL (analysis is debounced)
    await waitFor(() => expect(screen.getByTestId('equivalence-list')).toHaveTextContent('75.000 mL'));
  });

  it('validates numeric inputs and shows an error state', async () => {
    render(<App />);
    const volume = screen.getByTestId('analyte-volume');
    fireEvent.change(volume, { target: { value: '5000' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Maximum is 1000 mL');
    expect(volume).toHaveAttribute('aria-invalid', 'true');
    expect(useExperimentStore.getState().analyteVolumeML).toBe(50);
    fireEvent.change(volume, { target: { value: '120' } });
    expect(useExperimentStore.getState().analyteVolumeML).toBe(120);
    fireEvent.change(volume, { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number');
    await waitFor(() => expect(screen.getByTestId('equivalence-list')).toHaveTextContent('120.000 mL'));
  });

  it('adds an indicator and opens the indicator panel with spectra, ratio and colour', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByTestId('indicator-select'), 'methyl_orange');
    await user.click(screen.getByTestId('add-indicator'));
    expect(useExperimentStore.getState().addedIndicator?.indicatorId).toBe('methyl_orange');
    expect(screen.getByTestId('indicator-added')).toHaveTextContent('Methyl orange');
    await user.click(screen.getByTestId('indicator-panel-button'));
    const panel = screen.getByTestId('indicator-panel');
    expect(within(panel).getByTestId('structure-svg')).toBeInTheDocument();
    expect(within(panel).getByTestId('plot-stub')).toHaveAttribute('data-traces', '4');
    expect(within(panel).getByTestId('colour-hex')).toHaveTextContent(/^#[0-9a-f]{6}$/);
    expect(within(panel).getByTestId('indicator-ratio')).toHaveTextContent('[HIn]/[In⁻]');
    // Methyl orange at pH 2.88 is red: acid fraction dominates.
    const state = useExperimentStore.getState().currentState!;
    expect(state.indicator!.fractionAcid).toBeGreaterThan(0.7);
    await user.click(within(panel).getByTestId('close-indicator-panel'));
    expect(screen.queryByTestId('indicator-panel')).toBeNull();
  });

  it('Space and Shift use hold semantics and do not scroll the page', () => {
    render(<App />);
    const down = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    window.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(useExperimentStore.getState().isTitrating).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    expect(useExperimentStore.getState().isTitrating).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    expect(useExperimentStore.getState().isStirring).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(useExperimentStore.getState().isStirring).toBe(false);
    // Space inside a text field must keep its default behaviour.
    const search = screen.getByTestId('analyte-search');
    const inField = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    search.dispatchEvent(inField);
    expect(inField.defaultPrevented).toBe(false);
    expect(useExperimentStore.getState().isTitrating).toBe(false);
  });

  it('keyboard shortcuts switch lighting, hide panels, reset and screenshot', async () => {
    render(<App />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    expect(useExperimentStore.getState().lightingMode).toBe(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(useExperimentStore.getState().lightingMode).toBe(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    });
    expect(screen.queryByTestId('experiment-panel')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    });
    expect(screen.getByTestId('experiment-panel')).toBeInTheDocument();
    act(() => {
      useExperimentStore.getState().addTitrant(0.05);
    });
    expect(useExperimentStore.getState().titrationPoints).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    });
    expect(useExperimentStore.getState().titrationPoints).toHaveLength(0);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
      await Promise.resolve();
    });
    expect(downloadScreenshot).toHaveBeenCalled();
  });

  it('exports CSV with header and recorded points', async () => {
    const user = userEvent.setup();
    const spy = vi.mocked(downloadText);
    spy.mockClear();
    render(<App />);
    act(() => {
      useExperimentStore.getState().addTitrant(0.05);
      useExperimentStore.getState().addTitrant(0.05);
    });
    // The data panel re-renders at most 10×/s; wait for the export button to reflect the new points.
    await waitFor(() => expect(screen.getByTestId('export-csv')).toBeEnabled());
    await user.click(screen.getByTestId('export-csv'));
    expect(spy).toHaveBeenCalledTimes(1);
    const csv = spy.mock.calls[0][0];
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('added_volume_ml,pH');
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith('0.05,')).toBe(true);
  });

  it('toggles the dark theme and lighting buttons', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await user.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await user.click(screen.getByTestId('lighting-2'));
    expect(useExperimentStore.getState().lightingMode).toBe(2);
    expect(screen.getByTestId('lighting-2')).toHaveAttribute('aria-pressed', 'true');
  });

  it('resizes panels with the keyboard handle and clamps the width', () => {
    render(<App />);
    const handle = screen.getByTestId('experiment-panel-handle');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(useExperimentStore.getState().leftPanelWidth).toBe(400);
    for (let i = 0; i < 40; i++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(useExperimentStore.getState().leftPanelWidth).toBe(640);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(useExperimentStore.getState().leftPanelWidth).toBe(620);
    expect(screen.getByTestId('experiment-panel')).toHaveStyle({ width: '620px' });
  });

  it('shows the limit notification when the titrant limit is reached', () => {
    render(<App />);
    act(() => {
      useExperimentStore.getState().setConfig({ analyteVolumeML: 1 });
      for (let i = 0; i < 10; i++) useExperimentStore.getState().addTitrant(0.5);
    });
    expect(useExperimentStore.getState().limitReached).toBe(true);
    expect(screen.getAllByTestId('toast').some((t) => /limit reached/i.test(t.textContent ?? ''))).toBe(true);
  });
});

describe('mobile hold controls', () => {
  it('activate on press and release on pointer up / leave / cancel', () => {
    render(<MobileControls />);
    const titrate = screen.getByTestId('mobile-titrate');
    fireEvent.pointerDown(titrate, { pointerId: 1 });
    expect(useExperimentStore.getState().isTitrating).toBe(true);
    fireEvent.pointerUp(titrate, { pointerId: 1 });
    expect(useExperimentStore.getState().isTitrating).toBe(false);
    fireEvent.pointerDown(titrate, { pointerId: 1 });
    fireEvent.pointerLeave(titrate, { pointerId: 1 });
    expect(useExperimentStore.getState().isTitrating).toBe(false);
    const stir = screen.getByTestId('mobile-stir');
    fireEvent.touchStart(stir);
    expect(useExperimentStore.getState().isStirring).toBe(true);
    fireEvent.touchCancel(stir);
    expect(useExperimentStore.getState().isStirring).toBe(false);
    fireEvent.touchStart(stir);
    fireEvent.touchEnd(stir);
    expect(useExperimentStore.getState().isStirring).toBe(false);
  });
});

describe('NumberField', () => {
  it('commits valid values and reports invalid ones', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={1} min={0} max={10} unit="mL" onChange={onChange} testId="nf" />);
    const input = screen.getByTestId('nf');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(5);
    fireEvent.change(input, { target: { value: '50' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Maximum is 10 mL');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
