/** Text formatting helpers for chemical formulas and numbers. */

const SUBSCRIPTS: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
const SUPERSCRIPTS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻' };

/**
 * Pretty-print an ASCII formula: digits following an element or bracket become subscripts,
 * a trailing charge (e.g. "^2-", "2+", "-", "+") becomes a superscript.
 * Examples: "H2PO4-" → "H₂PO₄⁻", "CO3^2-" → "CO₃²⁻", "Ca2+" → "Ca²⁺", "NH4+" → "NH₄⁺".
 */
export function formatFormula(ascii: string): string {
  let body = ascii;
  let charge = '';
  const caret = body.indexOf('^');
  if (caret >= 0) {
    charge = body.slice(caret + 1);
    body = body.slice(0, caret);
  } else {
    const m = body.match(/^(.*?)(\d*[+-])$/);
    if (m && /[A-Za-z)\]]\d*[+-]$/.test(body)) {
      // Trailing charge only when preceded by a letter/bracket (not a plain numeric suffix).
      body = m[1];
      charge = m[2];
      // "Ca2+" → body "Ca", charge "2+" — but "H2PO4-" must keep the 4 as a subscript: the charge digits are
      // only those immediately before the sign when the body ends in a letter/bracket.
      const digits = charge.match(/^(\d*)([+-])$/);
      if (digits && digits[1].length > 0) {
        const before = body[body.length - 1];
        if (!/[A-Za-z)\]]/.test(before ?? '')) {
          body = `${body}${digits[1]}`;
          charge = digits[2];
        }
      }
    }
  }
  const formatted = body.replace(/([A-Za-z)\]])(\d+)/g, (_, el: string, num: string) => el + num.replace(/\d/g, (d) => SUBSCRIPTS[d]));
  const sup = charge.replace(/[0-9+-]/g, (c) => SUPERSCRIPTS[c] ?? c);
  return formatted + sup;
}

export function formatPH(pH: number): string {
  return pH.toFixed(2);
}

export function formatVolume(mL: number, decimals = 3): string {
  return `${mL.toFixed(decimals)} mL`;
}

export function formatConcentration(m: number): string {
  if (m >= 0.01) return `${m.toPrecision(3)} M`;
  return `${m.toExponential(2)} M`;
}

export function formatPercent(x: number, decimals = 2): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(decimals)} %`;
}
