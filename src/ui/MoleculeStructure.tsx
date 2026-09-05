/**
 * Renders a molecular structure from a SMILES string (PubChem) with smiles-drawer (MIT).
 * If drawing fails the component shows an explicit "structure unavailable" state — a structure
 * is never invented.
 */
import { useEffect, useRef, useState } from 'react';
import SmilesDrawer from 'smiles-drawer';

interface MoleculeStructureProps {
  smiles: string;
  name: string;
  dark: boolean;
}

export function MoleculeStructure({ smiles, name, dark }: MoleculeStructureProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    setFailed(false);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    try {
      const drawer = new SmilesDrawer.SmiDrawer({ width: 320, height: 200, bondThickness: 1.1, compactDrawing: false });
      drawer.draw(
        smiles,
        svg,
        dark ? 'dark' : 'light',
        () => undefined,
        () => setFailed(true),
      );
    } catch {
      setFailed(true);
    }
  }, [smiles, dark]);
  return (
    <figure className="rounded-lg p-2" style={{ background: 'var(--card-bg)', border: '1px solid var(--input-border)' }}>
      {failed ? (
        <p className="text-xs tv-muted" data-testid="structure-unavailable">
          Structure unavailable for {name}.
        </p>
      ) : (
        <svg ref={ref} viewBox="0 0 320 200" className="w-full h-auto" role="img" aria-label={`Structure of ${name}`} data-testid="structure-svg" />
      )}
      <figcaption className="text-[0.65rem] tv-muted mt-1 break-all">SMILES (PubChem): {smiles}</figcaption>
    </figure>
  );
}
