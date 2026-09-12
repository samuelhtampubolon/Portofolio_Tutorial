/**
 * The icon set.
 *
 * One stroke-based visual language at a 24×24 grid: 1.6 px strokes, round
 * caps and joins, `currentColor` throughout so icons inherit text colour and
 * theme automatically. No icon font, no sprite sheet, no network request —
 * each icon is a path string inlined into an <svg> on demand.
 */

const P = {
  /* ---------------------------------------------------------- file */
  'file-new': 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM13 3v6h6',
  'file-open': 'M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h13.2a1.8 1.8 0 0 0 1.74-1.34L22 10H6.5a1.8 1.8 0 0 0-1.74 1.34L3 17',
  'file-save': 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM7 3v6h8M8 21v-6h8v6',
  'file-save-as': 'M19 12V6l-4-4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6M7 2v5h7M15.5 20.5 21 15l2 2-5.5 5.5H15z',
  'file-import': 'M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  'file-export': 'M12 15V4m0 0 4 4m-4-4L8 8M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  'file-recent': 'M12 21a9 9 0 1 0-8.5-12M3 4v5h5M12 8v4.5l3 2',
  'template': 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M9 9v12',
  'doc-props': 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',

  /* ---------------------------------------------------------- edit */
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3.5 2',
  copy: 'M9 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  cut: 'M6.5 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.6 8.4 20 20M20 4 8.6 15.6',
  paste: 'M9 3h6v3H9zM9 4.5H7a2 2 0 0 0-2 2V20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2M9 13h6M9 17h4',
  duplicate: 'M8 8h12v12H8zM4 16V4h12',
  trash: 'M4 6h16M9 6V4h6v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6',
  'select-all': 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 8h8v8H8z',
  'select-none': 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M9 9l6 6M15 9l-6 6',
  'select-invert': 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 15 15 3M3 21 21 3M9 21 21 9',
  rename: 'M4 20h16M4 16l10.5-10.5a2.1 2.1 0 0 1 3 3L7 19l-4 1z',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7.18 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 12.6H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 7.18l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9.4 3.6V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 9.4H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.6z',

  /* -------------------------------------------------------- solids */
  box: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  cylinder: 'M12 7c4.97 0 9-1.12 9-2.5S16.97 2 12 2 3 3.12 3 4.5 7.03 7 12 7zM3 4.5v15C3 20.88 7.03 22 12 22s9-1.12 9-2.5v-15',
  sphere: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  cone: 'M12 2 3 19M12 2l9 17M3 19c0 1.66 4.03 3 9 3s9-1.34 9-3M3 19c0-1.66 4.03-3 9-3s9 1.34 9 3',
  torus: 'M12 20.5c5.52 0 10-3.36 10-7.5S17.52 5.5 12 5.5 2 8.86 2 13s4.48 7.5 10 7.5zM12 16c2.76 0 5-1.34 5-3s-2.24-3-5-3-5 1.34-5 3 2.24 3 5 3z',
  tube: 'M12 7c4.97 0 9-1.12 9-2.5S16.97 2 12 2 3 3.12 3 4.5 7.03 7 12 7zM12 5.6c2.2 0 4-.49 4-1.1s-1.8-1.1-4-1.1-4 .49-4 1.1 1.8 1.1 4 1.1zM3 4.5v15C3 20.88 7.03 22 12 22s9-1.12 9-2.5v-15',
  wedge: 'M3 20V6l16 14zM3 6l16 14M3 20h16',
  prism: 'M12 2 3 7.5v9l9 5.5 9-5.5v-9zM3 7.5l9 5.5 9-5.5M12 13v9',
  pyramid: 'M12 2 2 20h20zM12 2v18M2 20l10-6 10 6',
  plate: 'M6 8h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  helix: 'M8 3c0 2 8 2 8 4s-8 2-8 4 8 2 8 4-8 2-8 4M16 3c0 2-8 2-8 4M16 19c0-2-8-2-8-4',
  mesh: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10M7.5 9.5v5.2M16.5 9.5v5.2',

  /* -------------------------------------------------------- sketch */
  extrude: 'M4 20h10V10H4zM4 10l5-6h10v10l-5 6M14 10l5-6M14 20l5-6',
  revolve: 'M12 2v20M9 5c5 0 9 3.13 9 7s-4 7-9 7M9 5v14',
  sketch: 'M3 21l1-4L16 5l4 4L8 21zM14 7l4 4',
  'profile-link': 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',

  /* ------------------------------------------------------- combine */
  union: 'M9 15a6 6 0 1 1 6-6M9 9h6v6a6 6 0 1 1-6-6z',
  subtract: 'M9 15a6 6 0 1 1 6-6M9 9h6v6',
  intersect: 'M9 15a6 6 0 1 1 6-6 6 6 0 1 1-6 6zM9 9h6v6H9z',
  'pattern-linear': 'M4 6h4v4H4zM10 6h4v4h-4zM16 6h4v4h-4zM4 14h4v4H4zM10 14h4v4h-4zM16 14h4v4h-4z',
  'pattern-circular': 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  mirror: 'M12 2v20M8 7 3 12l5 5zM16 7l5 5-5 5z',
  group: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',

  /* ----------------------------------------------------- transform */
  move: 'M12 2v20M2 12h20M12 2 9 5M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  rotate: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  scale: 'M4 4h7v7H4zM14 14h6v6h-6zM11 11l3 3M20 4l-6 6M20 4h-5M20 4v5',
  align: 'M3 3v18M7 7h10v3H7zM7 14h6v3H7z',
  drop: 'M12 3v12m0 0 4-4m-4 4-4-4M4 20h16',
  center: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  reset: 'M3 12a9 9 0 1 0 2.64-6.36M3 3v6h6',

  /* ---------------------------------------------------------- view */
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 9h6v6H9z',
  'zoom-sel': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.5-4.5M8.5 11h5M11 8.5v5',
  'zoom-in': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.5-4.5M8.5 11h5M11 8.5v5',
  'zoom-out': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.5-4.5M8.5 11h5',
  ortho: 'M4 6h16v12H4zM4 6l3-3h16v12l-3 3',
  perspective: 'M6 8l12-3v14L6 16zM6 8v8M18 5v14',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  axes: 'M12 21V3M12 21 4 17M12 21l8-4M12 3l-3 3M12 3l3 3',
  ground: 'M2 17h20M5 13l3-3 3 3M13 13l3-4 3 4',
  'shade-solid': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 2a10 10 0 0 1 0 20z',
  'shade-edges': 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  'shade-wire': 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10M3 17l9-5 9 5',
  'shade-xray': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0z',
  section: 'M3 12h18M7 3h10v18H7zM7 3 3 7M17 3l4 4M7 21l-4-4M17 21l4-4',
  camera: 'M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'view-front': 'M4 4h16v16H4zM4 4l3-2h16v16l-3 2',
  'view-top': 'M12 3 3 8l9 5 9-5zM3 8v8l9 5 9-5V8',
  'view-right': 'M8 4l12 4v8l-12 4zM8 4v16M20 8v8',
  'view-iso': 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  fullscreen: 'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  'panel-left': 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 3v18',
  'panel-right': 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM15 3v18',
  'panel-bottom': 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 15h18',

  /* ------------------------------------------------------- measure */
  ruler: 'M3.3 13.7 13.7 3.3a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L10.3 20.7a1 1 0 0 1-1.4 0l-5.6-5.6a1 1 0 0 1 0-1.4zM7 10l2 2M10 7l2 2M13 4l2 2M4 13l2 2',
  angle: 'M4 20h16M4 20V6M4 20 18 8M9 20a5 5 0 0 0-1.2-3.3',
  probe: 'M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 1v3M12 20v3M1 13h3M20 13h3',
  mass: 'M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 6v3M5 9h14l2 11H3zM9 13h6',

  /* -------------------------------------------------- drafting */
  line: 'M4 20 20 4M4 20a1.6 1.6 0 1 0 0-3.2M20 7.2A1.6 1.6 0 1 0 20 4',
  polyline: 'M3 18l5-9 5 5 8-11M3 18a1.4 1.4 0 1 0 0-2.8M21 5.8A1.4 1.4 0 1 0 21 3',
  rect: 'M4 6h16v12H4z',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  arc: 'M3 19a12 12 0 0 1 18-8M3 19a1.5 1.5 0 1 0 0-3M21 12.5a1.5 1.5 0 1 0 0-3',
  ellipse: 'M12 19c5 0 9-3.13 9-7s-4-7-9-7-9 3.13-9 7 4 7 9 7z',
  polygon: 'M12 2.5 21 8v8l-9 5.5L3 16V8z',
  spline: 'M3 18c5 0 4-12 9-12s4 12 9 12',
  point: 'M12 8v8M8 12h8M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  'dim-linear': 'M3 12h18M3 8v8M21 8v8M6 9l-3 3 3 3M18 9l3 3-3 3',
  'dim-aligned': 'M5 19 19 5M3 17l2 2 2-2M17 3l2 2-2 2M4 21l3-3M17 6l3-3',
  'dim-radial': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12l7-7M14 5h5v5',
  'dim-angular': 'M4 20h16M4 20 16 4M4 20a10 10 0 0 0 3-7',
  offset: 'M7 7h10v10H7zM3 3h18v18H3z',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 1 1-4 0V4zM6 8h4M14 8h4',
  'ortho-lock': 'M12 3v18M3 12h18M6 6h4v4H6z',
  polar: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12l6-6M12 12H3M12 12v9',
  layers: 'M12 2 2 7l10 5 10-5zM2 12l10 5 10-5M2 17l10 5 10-5',

  /* ---------------------------------------------------- simulation */
  play: 'M7 4.5v15l13-7.5z',
  pause: 'M8 4h3v16H8zM13 4h3v16h-3z',
  stop: 'M6 6h12v12H6z',
  rewind: 'M6 5v14M20 5v14l-9-7z',
  forward: 'M18 5v14M4 5v14l9-7z',
  'step-back': 'M6 5v14M18 6v12l-9-6z',
  'step-fwd': 'M18 5v14M6 6v12l9-6z',
  key: 'M12 4.5 15.5 12 12 19.5 8.5 12z',
  sequence: 'M3 6h8M3 12h14M3 18h6M15 4v4M19 10v4M11 16v4',
  physics: 'M12 22a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 14V6M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 18l2.8-1.6M18 18l-2.8-1.6',
  motor: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v3M12 19v3M2 12h3M19 12h3M20 6l-2.6 1.5M4 18l2.6-1.5M20 18l-2.6-1.5M4 6l2.6 1.5',
  bake: 'M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M8 17h8',
  record: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  timeline: 'M3 6h18M3 6v12M8 4v4M14 4v4M20 4v4M6 14h8M6 18h12',

  /* ---------------------------------------------------------- misc */
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  command: 'M6 3a3 3 0 1 1 3 3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3H6z',
  code: 'M8 6l-5 6 5 6M16 6l5 6-5 6M13.5 4l-3 16',
  merge: 'M7 21V9a4 4 0 0 0 4 4h3m0 0-3-3m3 3-3 3M7 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  'sheet': 'M4 3h16v18H4zM4 16h16M15 16v5M4 8h11M15 3v5',
  deviation: 'M3 17c3 0 4-10 7-10s4 10 7 10h4M3 21h18',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.2 9a3 3 0 1 1 4 2.8c-.7.3-1.2 1-1.2 1.8v.4M12 17.5h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5h.01',
  book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5zM4 19.5A2.5 2.5 0 0 1 6.5 17H20v5H6.5A2.5 2.5 0 0 1 4 19.5z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  github: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
  warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  check: 'M20 6 9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M18 6 6 18M6 6l12 12',
  'chevron-right': 'm9 18 6-6-6-6',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-left': 'm15 18-6-6 6-6',
  dots: 'M12 6h.01M12 12h.01M12 18h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3 3.9M6.2 6.2A18 18 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.3-.9M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  palette: 'M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.2-1.8 4-4 4h-1.8a1.7 1.7 0 0 0-1.2 2.9c.3.3.5.8.5 1.2 0 1-.8 1.9-2.5 1.9zM7.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM11 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM15.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  star: 'm12 2.5 2.9 5.9 6.6 1-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.4l6.6-1z',
  workspace: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  bulb: 'M9 21h6M10 18h4M12 2a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 2z',
  gauge: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12l4-4M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  table: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18',
  image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 11a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM21 16l-5-5L5 21',
  cube3d: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
};

/** Icons that read better filled than stroked. */
const FILLED = new Set(['play', 'pause', 'stop', 'key', 'record', 'rewind', 'forward', 'step-back', 'step-fwd']);

/**
 * Build an <svg> element for `name`.
 * Unknown names fall back to a neutral dot so the UI never renders a gap.
 */
export function icon(name, { size = 16, stroke = 1.6, cls = '' } = {}) {
  const d = P[name];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d || 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z');
  if (FILLED.has(name)) {
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('stroke', 'none');
  } else {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', stroke);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

export function hasIcon(name) { return Object.prototype.hasOwnProperty.call(P, name); }
export const ICON_NAMES = Object.keys(P);
