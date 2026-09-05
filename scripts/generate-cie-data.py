#!/usr/bin/env python3
"""
Generate src/chemistry/data/cie.ts from the colour-science reference datasets.

Sources (fetched on 2026-09-05):
  https://raw.githubusercontent.com/colour-science/colour/develop/colour/colorimetry/datasets/cmfs.py
  https://raw.githubusercontent.com/colour-science/colour/develop/colour/colorimetry/datasets/illuminants/sds.py
which tabulate the CIE 1931 2° Standard Observer (CIE 15:2004 / CVRL) and the
CIE Standard Illuminant D65 relative SPD (CIE 15:2004 Table T.1).

Usage: python3 scripts/generate-cie-data.py <cmfs.py> <sds.py> > src/chemistry/data/cie.ts
"""
import re
import sys

cmfs_src = open(sys.argv[1]).read()
sds_src = open(sys.argv[2]).read()

i = cmfs_src.index('"CIE 1931 2 Degree Standard Observer": {')
j = cmfs_src.index('},', i)
cmf_rows = {int(w): tuple(float(v) for v in vals.split(','))
            for w, vals in re.findall(r'(\d+):\s*\(([^)]*)\)', cmfs_src[i:j])}

i = sds_src.index('"D65": {')
j = sds_src.index('}', i)
d65_rows = {int(w): float(v) for w, v in re.findall(r'(\d+):\s*([0-9.]+)', sds_src[i:j])}

grid = list(range(380, 781, 5))
for w in grid:
    assert w in cmf_rows, w
    assert w in d65_rows, w

def fmt(x):
    return repr(float(f"{x:.9g}"))

out = []
out.append("/**")
out.append(" * CIE colorimetric reference data on the common 5 nm wavelength grid (380–780 nm).")
out.append(" *")
out.append(" * GENERATED FILE — do not edit by hand. Regenerate with scripts/generate-cie-data.py.")
out.append(" *")
out.append(" * Provenance:")
out.append(" *  - CIE 1931 2° Standard Observer colour-matching functions x̄(λ), ȳ(λ), z̄(λ):")
out.append(" *    CIE 15:2004 'Colorimetry' Table T.4, as distributed by CVRL (http://cvrl.ioo.ucl.ac.uk/cie.htm)")
out.append(" *    and mirrored in colour-science `colour/colorimetry/datasets/cmfs.py` (BSD-3-Clause), accessed 2026-09-05.")
out.append(" *  - CIE Standard Illuminant D65 relative spectral power distribution S(λ):")
out.append(" *    CIE 15:2004 Table T.1, as mirrored in colour-science `colour/colorimetry/datasets/illuminants/sds.py`, accessed 2026-09-05.")
out.append(" *  - Both datasets are tabulated at 5 nm by the CIE; the values below are the tabulated 5 nm entries (no interpolation).")
out.append(" */")
out.append("")
out.append("/** Common wavelength grid (nm) shared by spectra, colour-matching functions and illuminant. */")
out.append("export const WAVELENGTH_GRID: readonly number[] = [" + ", ".join(str(w) for w in grid) + "];")
out.append("")
out.append("export const WAVELENGTH_MIN = 380;")
out.append("export const WAVELENGTH_MAX = 780;")
out.append("export const WAVELENGTH_STEP = 5;")
out.append("")
out.append("/** CIE 1931 2° x̄(λ) on WAVELENGTH_GRID. */")
out.append("export const CIE_XBAR: readonly number[] = [" + ", ".join(fmt(cmf_rows[w][0]) for w in grid) + "];")
out.append("/** CIE 1931 2° ȳ(λ) on WAVELENGTH_GRID. */")
out.append("export const CIE_YBAR: readonly number[] = [" + ", ".join(fmt(cmf_rows[w][1]) for w in grid) + "];")
out.append("/** CIE 1931 2° z̄(λ) on WAVELENGTH_GRID. */")
out.append("export const CIE_ZBAR: readonly number[] = [" + ", ".join(fmt(cmf_rows[w][2]) for w in grid) + "];")
out.append("")
out.append("/** CIE Standard Illuminant D65 relative SPD on WAVELENGTH_GRID (normalised to 100 at 560 nm by the CIE). */")
out.append("export const ILLUMINANT_D65: readonly number[] = [" + ", ".join(fmt(d65_rows[w]) for w in grid) + "];")
out.append("")
print("\n".join(out))
