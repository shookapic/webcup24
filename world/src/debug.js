// Movement probe, only active with ?debug in the URL.
//   ?debug            record samples, expose window.__tn
//   ?debug&scene=floor  floor collider + player only
//   ?debug&fps=144    deterministic frames: window.__tn.run(seconds, input) drives R3F at that rate
const params = new URLSearchParams(location.search);

export const debug = {
  enabled: params.has('debug'),
  floorOnly: params.get('scene') === 'floor',
  simFps: Number(params.get('fps')) || 0,
  input: null, // overrides keyboard while set
  samples: [],
};

if (debug.enabled) window.__tn = debug;

export function record(sample) {
  if (!debug.enabled) return;
  debug.samples.push(sample);
  if (debug.samples.length > 20_000) debug.samples.shift();
}
