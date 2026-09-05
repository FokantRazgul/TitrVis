import { createContext, useContext } from 'react';
import type { SimulationManager } from '../simulation/SimulationManager';

export const SimulationContext = createContext<SimulationManager | null>(null);

export function useSimulationManager(): SimulationManager {
  const manager = useContext(SimulationContext);
  if (!manager) throw new Error('useSimulationManager must be used inside <Scene>');
  return manager;
}
