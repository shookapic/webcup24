import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Colonist } from './Colonist.jsx';
import { pathLinks, pathNodes } from './layout.js';

const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const outfits = ['#4a8c87', '#e5e0d4', '#a9654a', '#688c73', '#e9ba69', '#293d49'];
const accents = ['#293d49', '#a9654a', '#4a8c87', '#6b5a4a'];
const COUNT = 12;
const TURN = 4; // rad/s: smooth corners, no snapping
const ARRIVE = 1.2; // m from the target counts as reached

function createBots() {
  let seed = 42;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const names = Object.keys(pathNodes);
  return Array.from({ length: COUNT }, (_, i) => {
    const from = names[i % names.length];
    const bot = {
      avatar: { skin: pick(skins), outfit: pick(outfits), accent: pick(accents) },
      from,
      to: pick(pathLinks[from]),
      speed: 1.1 + random() * 0.8,
      lane: (random() - 0.5) * 1.6,
      pause: 0,
      x: pathNodes[from][0],
      z: pathNodes[from][1],
      heading: 0,
      moving: false,
      random,
      pick,
    };
    retarget(bot);
    // Start part-way along the first segment so the crowd doesn't spawn stacked on the nodes.
    const f = 0.15 + random() * 0.7;
    bot.x += (pathNodes[bot.to][0] - bot.x) * f;
    bot.z += (pathNodes[bot.to][1] - bot.z) * f;
    bot.heading = Math.atan2(bot.tx - bot.x, bot.tz - bot.z);
    return bot;
  });
}

// Target = destination node shifted sideways by this bot's lane, so walkers don't stack and corners stay continuous.
function retarget(bot) {
  const [ax, az] = pathNodes[bot.from];
  const [bx, bz] = pathNodes[bot.to];
  const length = Math.hypot(bx - ax, bz - az) || 1;
  bot.tx = bx + (-(bz - az) / length) * bot.lane;
  bot.tz = bz + ((bx - ax) / length) * bot.lane;
}

const turnBy = (from, to) => ((((to - from + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

function step(bot, delta) {
  if (bot.pause > 0) {
    bot.pause -= delta;
    bot.moving = false;
    return;
  }
  const dx = bot.tx - bot.x;
  const dz = bot.tz - bot.z;
  if (Math.hypot(dx, dz) < ARRIVE) {
    const options = pathLinks[bot.to].filter((name) => name !== bot.from);
    bot.from = bot.to;
    bot.to = bot.pick(options.length ? options : pathLinks[bot.to]); // reverse only at dead ends
    retarget(bot);
    if (bot.random() < 0.35) bot.pause = 2 + bot.random() * 4;
    return;
  }
  const wanted = Math.atan2(dx, dz);
  const turn = turnBy(bot.heading, wanted);
  bot.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN * delta);
  // Slow while turning sharply, so the walk reads as a corner and not a skid.
  const pace = bot.speed * (Math.abs(turn) > 0.9 ? 0.4 : 1);
  bot.x += Math.sin(bot.heading) * pace * delta;
  bot.z += Math.cos(bot.heading) * pace * delta;
  bot.moving = true;
  bot.pace = pace;
}

export function Npcs({ reducedMotion }) {
  const bots = useMemo(createBots, []);
  const groups = useRef([]);

  // Travel continues under reduced motion; only the gait animation settles (Colonist handles that).
  useFrame((_, delta) => {
    bots.forEach((bot, i) => {
      step(bot, Math.min(delta, 0.1));
      groups.current[i]?.position.set(bot.x, 0, bot.z);
      if (groups.current[i]) groups.current[i].rotation.y = bot.heading;
    });
  });

  return bots.map((bot, i) => (
    <group key={i} ref={(g) => { groups.current[i] = g; }}>
      <Colonist avatar={bot.avatar} reducedMotion={reducedMotion} getState={() => ({ speed: bot.moving ? bot.pace : 0, air: false })} />
    </group>
  ));
}
