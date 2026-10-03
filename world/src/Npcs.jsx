import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Colonist } from './Colonist.jsx';
import { debug } from './debug.js';
import { pathLinks, pathNodes, seats } from './layout.js';

const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const outfits = ['#4a8c87', '#e5e0d4', '#a9654a', '#688c73', '#e9ba69', '#293d49'];
const accents = ['#293d49', '#a9654a', '#4a8c87', '#6b5a4a'];
const COUNT = 12;
const TURN = 4; // rad/s: smooth corners, no snapping
const ARRIVE = 1.2; // m from the target counts as reached
const SEAT_RANGE = 14; // a walker only considers benches this close to its current node
const SEAT_Y = 0.176; // avatar origin height while seated: thigh underside = (0.8 - 0.2) x HEIGHT_SCALE (0.64) rests on the 0.56 m seat top
const SIT_MS = 0.8; // s to back into / out of the seat

// Seat reservation: seats[i] is owned by at most one bot from the moment it is chosen until that bot has stood up and left.
const owner = new Array(seats.length).fill(null);

function createBots() {
  let seed = 42;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const names = Object.keys(pathNodes);
  return Array.from({ length: COUNT }, (_, i) => {
    const from = names[i % names.length];
    const bot = {
      id: i,
      avatar: { skin: pick(skins), outfit: pick(outfits), accent: pick(accents) },
      from,
      to: pick(pathLinks[from]),
      speed: 1.1 + random() * 0.8,
      lane: (random() - 0.5) * 1.6,
      mode: 'walk', // walk | pause | approach | turn | sitDown | sit | standUp
      timer: 0,
      seat: -1,
      x: pathNodes[from][0],
      z: pathNodes[from][1],
      y: 0,
      heading: 0,
      moving: false,
      sit: false,
      pace: 0,
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

// Steer towards (tx, tz) at `speed`; returns the remaining distance.
function walkTo(bot, tx, tz, speed, delta) {
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const turn = turnBy(bot.heading, Math.atan2(dx, dz));
  bot.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN * delta);
  // Slow while turning sharply, so the walk reads as a corner and not a skid.
  const pace = speed * (Math.abs(turn) > 0.9 ? 0.4 : 1);
  bot.x += Math.sin(bot.heading) * pace * delta;
  bot.z += Math.cos(bot.heading) * pace * delta;
  bot.moving = true;
  bot.pace = pace;
  return Math.hypot(dx, dz);
}

function chooseSeat(bot) {
  let best = -1;
  let bestD = SEAT_RANGE;
  seats.forEach((seat, i) => {
    if (owner[i] !== null) return;
    const d = Math.hypot(seat.approach[0] - bot.x, seat.approach[1] - bot.z);
    if (d < bestD) { best = i; bestD = d; }
  });
  if (best >= 0) owner[best] = bot.id; // reserve now so no other walker heads for the same seat
  return best;
}

function step(bot, delta) {
  bot.moving = false;
  bot.sit = false;
  switch (bot.mode) {
    case 'pause':
      bot.timer -= delta;
      if (bot.timer <= 0) bot.mode = 'walk';
      return;
    case 'approach': {
      const seat = seats[bot.seat];
      if (walkTo(bot, seat.approach[0], seat.approach[1], bot.speed, delta) < 0.25) { bot.mode = 'turn'; bot.moving = false; }
      return;
    }
    case 'turn': {
      const seat = seats[bot.seat];
      const turn = turnBy(bot.heading, seat.ry);
      bot.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN * delta);
      if (Math.abs(turnBy(bot.heading, seat.ry)) < 0.02) { bot.heading = seat.ry; bot.mode = 'sitDown'; bot.timer = 0; bot.sx = bot.x; bot.sz = bot.z; }
      return;
    }
    case 'sitDown': {
      const seat = seats[bot.seat];
      bot.timer = Math.min(SIT_MS, bot.timer + delta);
      const k = bot.timer / SIT_MS;
      bot.x = bot.sx + (seat.x - bot.sx) * k; // from wherever the turn ended, no snap to the exact approach point
      bot.z = bot.sz + (seat.z - bot.sz) * k;
      bot.y = SEAT_Y * k;
      bot.sit = true;
      if (k >= 1) { bot.mode = 'sit'; bot.timer = 8 + bot.random() * 14; }
      return;
    }
    case 'sit':
      bot.sit = true;
      bot.y = SEAT_Y;
      bot.timer -= delta;
      if (bot.timer <= 0) { bot.mode = 'standUp'; bot.timer = 0; }
      return;
    case 'standUp': {
      const seat = seats[bot.seat];
      bot.timer = Math.min(SIT_MS, bot.timer + delta);
      const k = bot.timer / SIT_MS;
      bot.x = seat.x + (seat.approach[0] - seat.x) * k;
      bot.z = seat.z + (seat.approach[1] - seat.z) * k;
      bot.y = SEAT_Y * (1 - k);
      bot.sit = k < 0.5;
      if (k >= 1) {
        owner[bot.seat] = null; // seat is free only once the walker has left it
        bot.seat = -1;
        bot.y = 0;
        bot.mode = 'walk';
        retarget(bot);
      }
      return;
    }
    default: {
      if (walkTo(bot, bot.tx, bot.tz, bot.speed, delta) < ARRIVE) {
        const options = pathLinks[bot.to].filter((name) => name !== bot.from);
        bot.from = bot.to;
        bot.to = bot.pick(options.length ? options : pathLinks[bot.to]); // reverse only at dead ends
        retarget(bot);
        const roll = bot.random();
        if (roll < 0.18) {
          const seat = chooseSeat(bot);
          if (seat >= 0) { bot.seat = seat; bot.mode = 'approach'; }
        } else if (roll < 0.42) { bot.mode = 'pause'; bot.timer = 2 + bot.random() * 4; }
      }
    }
  }
}

export function Npcs({ reducedMotion }) {
  const bots = useMemo(createBots, []);
  const groups = useRef([]);
  if (debug.enabled) {
    debug.npcs = bots;
    debug.seatOwner = owner;
    // QA: send bot `b` to seat `i` now (same reservation rules as the natural behaviour).
    debug.forceSit = (b, i) => {
      const bot = bots[b];
      if (owner[i] !== null || bot.mode !== 'walk') return false;
      owner[i] = bot.id;
      bot.seat = i;
      bot.mode = 'approach';
      return true;
    };
  }

  // Travel continues under reduced motion; only the gait animation settles (Colonist handles that).
  useFrame((_, delta) => {
    bots.forEach((bot, i) => {
      step(bot, Math.min(delta, 0.1));
      const group = groups.current[i];
      if (!group) return;
      group.position.set(bot.x, bot.y, bot.z);
      group.rotation.y = bot.heading;
    });
  });

  return bots.map((bot, i) => (
    <group key={i} ref={(g) => { groups.current[i] = g; }}>
      <Colonist avatar={bot.avatar} reducedMotion={reducedMotion} getState={() => ({ speed: bot.moving ? bot.pace : 0, air: false, sit: bot.sit })} />
    </group>
  ));
}
