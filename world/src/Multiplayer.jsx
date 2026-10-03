import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler } from 'three';
import { Colonist } from './Colonist.jsx';
import { api } from './api.js';

const POLL = 2000; // No WebSockets on Hodifly: post our position, read everyone else's.
const euler = new Euler();
const turn = (from, to) => ((((to - from + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

export function Multiplayer({ ecctrl }) {
  const [players, setPlayers] = useState([]);
  const targets = useRef(new Map());
  const groups = useRef(new Map());
  const speeds = useRef(new Map()); // m/s from displacement: drives idle/walk since the API carries no animation state
  const lastOk = useRef(Date.now());

  useEffect(() => {
    let timer;
    let alive = true;
    let running = false;
    // Polling stops while the tab is hidden (no requests, no battery / data) and refreshes at once when it comes back.
    const tick = async () => {
      clearTimeout(timer);
      if (!alive || running || document.hidden) return;
      running = true;
      try {
        const body = ecctrl.current;
        if (body) {
          euler.setFromQuaternion(body.currQuat, 'YXZ');
          await api('/api/presence', 'POST', { x: body.currPos.x, z: body.currPos.z, ry: euler.y });
        }
        const { players: list } = await api('/api/presence');
        if (!alive) return;
        targets.current = new Map(list.map((player) => [player.id, player]));
        lastOk.current = Date.now();
        setPlayers(list);
      } catch {
        // Offline or server restarting: keep the last positions, but drop peers once they are older than the server's 15 s window.
        if (alive && Date.now() - lastOk.current > 15_000) setPlayers((current) => (current.length ? [] : current));
      } finally {
        running = false;
        if (alive && !document.hidden) timer = setTimeout(tick, POLL);
      }
    };
    const visibility = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', visibility);
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [ecctrl]);

  // Glide towards the last known position so 2 s updates still look like walking.
  useFrame((_, delta) => {
    const blend = Math.min(1, delta * 4);
    for (const [id, group] of groups.current) {
      const target = targets.current.get(id);
      if (!target) continue;
      if (!group.userData.placed) {
        group.position.set(target.x, 0, target.z);
        group.rotation.y = target.ry;
        group.userData.placed = true;
        continue;
      }
      const [px, pz] = [group.position.x, group.position.z];
      group.position.x += (target.x - group.position.x) * blend;
      group.position.z += (target.z - group.position.z) * blend;
      speeds.current.set(id, Math.hypot(group.position.x - px, group.position.z - pz) / Math.max(delta, 1e-3));
      group.rotation.y += turn(group.rotation.y, target.ry) * blend;
    }
  });

  return players.map((player) => (
    <group
      key={player.id}
      ref={(group) => {
        if (group) groups.current.set(player.id, group);
        else groups.current.delete(player.id);
      }}
    >
      <Colonist avatar={player.avatar || undefined} getState={() => ({ speed: speeds.current.get(player.id) ?? 0, air: false })} />
    </group>
  ));
}
