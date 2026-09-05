/**
 * Plotly component factory using the basic distribution (scatter charts only) to keep the
 * bundle small. Both the titration graph and the spectrum graph use this component, and the
 * spectrum export uses Plotly's own `toImage`.
 */
import Plotly from 'plotly.js-basic-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

export const Plot = createPlotlyComponent(Plotly);
export { Plotly };
