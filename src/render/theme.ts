export interface Theme {
  bg: string;
  water: string;
  waterEdge: string;
  stationFill: string;
  stationStroke: string;
  peep: string;
  trainPeep: string;
  ring: string;
  ui: string;
  lines: string[];
}

const LINES = ['#e2412b', '#2468d8', '#18a058', '#f0a500', '#8a45b0', '#00a3b4', '#e8669a'];

export const DAY: Theme = {
  bg: '#f5f2ec',
  water: '#cfe1ee',
  waterEdge: '#bcd3e4',
  stationFill: '#ffffff',
  stationStroke: '#2a2424',
  peep: '#3b3434',
  trainPeep: '#ffffff',
  ring: '#2a2424',
  ui: '#2a2424',
  lines: LINES,
};

export const NIGHT: Theme = {
  bg: '#1c1a1b',
  water: '#1f3242',
  waterEdge: '#29404f',
  stationFill: '#1c1a1b',
  stationStroke: '#ece7df',
  peep: '#ece7df',
  trainPeep: '#ffffff',
  ring: '#ece7df',
  ui: '#ece7df',
  lines: ['#ff5a40', '#4d8cff', '#2fc272', '#ffbd2e', '#b06ad8', '#22c3d3', '#ff86b4'],
};
