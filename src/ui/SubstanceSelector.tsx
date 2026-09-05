/**
 * Searchable card grid of substances (analyte or titrant).
 */
import { useMemo, useState } from 'react';
import { reactiveSubstances, searchSubstances } from '../chemistry/substances';
import type { Substance } from '../chemistry/types';
import { formatFormula } from '../utils/format';

interface SubstanceSelectorProps {
  label: string;
  selectedId: string;
  onSelect: (id: string) => void;
  testId: string;
}

const TYPE_LABEL: Record<Substance['type'], string> = {
  strongAcid: 'strong acid',
  weakAcid: 'weak acid',
  strongBase: 'strong base',
  weakBase: 'weak base',
  ampholyte: 'ampholyte',
  salt: 'salt',
};

export function SubstanceSelector({ label, selectedId, onSelect, testId }: SubstanceSelectorProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const all = useMemo(() => reactiveSubstances(), []);
  const results = useMemo(() => searchSubstances(query, all), [query, all]);
  const selected = all.find((s) => s.id === selectedId);
  const visible = expanded || query ? results : results.slice(0, 8);

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        {selected && (
          <span className="text-xs tv-muted truncate" data-testid={`${testId}-selected`}>
            {selected.nameEn} · {formatFormula(selected.formula)}
          </span>
        )}
      </div>
      <input
        className="tv-input mt-1"
        type="search"
        placeholder="Search name or formula…"
        value={query}
        aria-label={`Search ${label.toLowerCase()}`}
        data-testid={`${testId}-search`}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="mt-2 grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto tv-scroll pr-0.5" role="listbox" aria-label={label}>
        {visible.map((s) => (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={s.id === selectedId}
            aria-pressed={s.id === selectedId}
            className="tv-card text-xs"
            data-testid={`${testId}-card-${s.id}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="block font-medium leading-tight">{s.nameEn}</span>
            <span className="block tv-muted leading-tight">{formatFormula(s.formula)}</span>
            <span className="block tv-muted leading-tight" style={{ fontSize: '0.68rem' }}>
              {TYPE_LABEL[s.type]}
              {s.acidSystem ? ` · pKa ${s.acidSystem.pKas.map((p) => p.toFixed(2)).join(', ')}` : ''}
              {s.baseSystem ? ` · ${s.baseSystem.pKbs ? `pKb ${s.baseSystem.pKbs.map((p) => p.toFixed(2)).join(', ')}` : `pKa(BH⁺) ${s.baseSystem.conjugateAcidPKas!.map((p) => p.toFixed(2)).join(', ')}`}` : ''}
            </span>
          </button>
        ))}
        {visible.length === 0 && <span className="text-xs tv-muted col-span-2">No substances match “{query}”.</span>}
      </div>
      {!query && results.length > 8 && (
        <button type="button" className="mt-1 text-xs underline tv-muted" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `Show all ${results.length}`}
        </button>
      )}
    </div>
  );
}
