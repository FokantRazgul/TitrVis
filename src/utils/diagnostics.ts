/**
 * Development-only diagnostics. In production builds these functions are no-ops so that
 * users never see technical output; the UI shows friendly notifications instead.
 */

import type { ChemistryErrorInfo } from '../chemistry/types';

export const IS_DEV: boolean = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

/** Log a chemistry failure with full context (development only). */
export function reportChemistryFailure(error: unknown, context: Record<string, unknown>): void {
  if (!IS_DEV) return;
  const info: ChemistryErrorInfo | undefined =
    error && typeof error === 'object' && 'info' in error ? (error as { info: ChemistryErrorInfo }).info : undefined;
  // eslint-disable-next-line no-console
  console.error('[TitrVis chemistry] failure', {
    type: info?.type ?? 'unknown',
    message: error instanceof Error ? error.message : String(error),
    details: info?.details,
    ladders: info?.problem?.ladders,
    spectators: info?.problem?.spectators,
    pKw: info?.problem?.pKw,
    activityModel: info?.problem?.activityModel,
    ...context,
    stack: error instanceof Error ? error.stack : undefined,
  });
}

/** Log a rendering / simulation problem (development only). */
export function reportRuntimeProblem(scope: string, error: unknown, extra?: Record<string, unknown>): void {
  if (!IS_DEV) return;
  // eslint-disable-next-line no-console
  console.error(`[TitrVis ${scope}]`, error, extra ?? '');
}
