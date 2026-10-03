import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Avatar } from './Avatar.jsx';

// Path network: nodes sit on the paths in City.jsx, just outside the buildings.
const nodes = {
  center: [0, 0],
  mairie: [0, -13],
  sante: [24, -3],
  marche: [-24, -1],
  sud: [0, 30],
  sudEst: [8, 32],
  sudOuest: [-8, 32],
  habitatPath: [-8, -24],
  habitat: [-18, -34],
};
const links = {
  center: ['mairie', 'sante', 'marche', 'sud'],
  mairie: ['center', 'habitatPath'],
  sante: ['center'],
  marche: ['center'],
  sud: ['center', 'sudEst', 'sudOuest'],
  sudEst: ['sud'],
  sudOuest: ['sud'],
  habitatPath: ['mairie', 'habitat'],
  habitat: ['habitatPath'],
};

const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const outfits = ['#3a6ea5', '#e8eef2', '#7a4fbf', '#2f8f6b', '#d9822b', '#c23b5a'];
const accents = ['#ff4fa3', '#5ee7ff', '#ffd36e', '#4cff9a'];
const FOOT = 0.75; // Avatar origin sits this far above its feet.
const COUNT = 14;

function createBots() {
  let seed = 42;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const names = Object.keys(nodes);
  return Array.from({ length: COUNT }, (_, i) => {
    const from = names[i % names.length];
    return {
      avatar: { skin: pick(skins), outfit: pick(outfits), accent: pick(accents) },
      from,
      to: pick(links[from]),
      progress: random(),
      speed: 1.2 + random() * 1.3,
      lane: (random() - 0.5) * 1.6,
      pause: 0,
      random,
      pick,
    };
  });
}

function step(bot, delta) {
  if (bot.pause > 0) {
    bot.pause -= delta;
    return;
  }
  const [ax, az] = nodes[bot.from];
  const [bx, bz] = nodes[bot.to];
  bot.progress += (bot.speed * delta) / Math.hypot(bx - ax, bz - az);
  if (bot.progress >= 1) {
    bot.progress = 0;
    bot.from = bot.to;
    bot.to = bot.pick(links[bot.from]);
    if (bot.random() < 0.3) bot.pause = 1 + bot.random() * 4;
  }
}

export function Npcs({ reducedMotion }) {
  const bots = useMemo(createBots, []);
  const groups = useRef([]);

  useFrame(({ clock }, delta) => {
    bots.forEach((bot, i) => {
      const group = groups.current[i];
      if (!group) return;
      if (!reducedMotion) step(bot, Math.min(delta, 0.1));
      const [ax, az] = nodes[bot.from];
      const [bx, bz] = nodes[bot.to];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      // Walk in a lane beside the path centre so bots don't stack up.
      const x = ax + dx * bot.progress + (-dz / length) * bot.lane;
      const z = az + dz * bot.progress + (dx / length) * bot.lane;
      const walking = bot.pause <= 0 && !reducedMotion;
      group.position.set(x, FOOT + (walking ? Math.abs(Math.sin(clock.elapsedTime * bot.speed * 5 + i)) * 0.08 : 0), z);
      group.rotation.y = Math.atan2(dx, dz);
    });
  });

  return bots.map((bot, i) => (
    <group key={i} ref={(g) => { groups.current[i] = g; }}>
      <Avatar avatar={bot.avatar} />
    </group>
  ));
}
