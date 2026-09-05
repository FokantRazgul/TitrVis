/**
 * Global keyboard controls:
 *   Space (hold) titrate · Shift (hold) stir · 1/2/3 lighting · R reset · S screenshot · H panels
 * Default browser behaviour is prevented only for Space (page scroll) when the event does not
 * originate from a text field.
 */
import { useEffect } from 'react';
import { useExperimentStore } from '../state/experimentStore';
import { dropAudio } from '../utils/audio';

export interface KeyboardActions {
  screenshot: () => void;
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useKeyboardControls(actions: KeyboardActions): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const store = useExperimentStore.getState();
      if (e.code === 'Space') {
        if (isTextTarget(e.target)) return;
        e.preventDefault();
        if (!e.repeat) {
          dropAudio.unlock();
          store.setTitrating(true);
        }
        return;
      }
      if (e.key === 'Shift') {
        if (!e.repeat) store.setStirring(true);
        return;
      }
      if (isTextTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case '1':
          store.setLightingMode(1);
          break;
        case '2':
          store.setLightingMode(2);
          break;
        case '3':
          store.setLightingMode(3);
          break;
        case 'r':
        case 'R':
        case 'к':
        case 'К':
          store.reset();
          store.pushToast('Experiment reset.', 'info');
          break;
        case 's':
        case 'S':
        case 'ы':
        case 'Ы':
          actions.screenshot();
          break;
        case 'h':
        case 'H':
        case 'р':
        case 'Р':
          store.togglePanels();
          break;
        default:
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const store = useExperimentStore.getState();
      if (e.code === 'Space') {
        if (!isTextTarget(e.target)) e.preventDefault();
        store.setTitrating(false);
      } else if (e.key === 'Shift') {
        store.setStirring(false);
      }
    };
    const release = () => {
      const store = useExperimentStore.getState();
      store.setTitrating(false);
      store.setStirring(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) release();
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
    };
  }, [actions]);
}
