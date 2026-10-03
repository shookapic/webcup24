import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler } from 'three';
import { Avatar } from './Avatar.jsx';
import { api } from './api.js';

const POLL = 2000; // No WebSockets on Hodifly: post our position, read everyone else's.
const BODY = 0.95; // Ecctrl body centre above the ground (float height + capsule).
const euler = new Euler();
const turn = (from, to) => ((((to - from + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

export function Multiplayer({ ecctrl }) {
  const [players, setPlayers] = useState([]);
  const targets = useRef(new Map());
  const groups = useRef(new Map());

  useEffect(() => {
    let timer;
    const tick = async () => {
      try {
        const body = ecctrl.current;
        if (body) {
          euler.setFromQuaternion(body.currQuat, 'YXZ');
          await api('/api/presence', 'POST', { x: body.currPos.x, z: body.currPos.z, ry: euler.y });
        }
        const { players: list } = await api('/api/presence');
        targets.current = new Map(list.map((player) => [player.id, player]));
        setPlayers(list);
      } catch {
        // Server restarting or offline: keep the last positions.
      }
      timer = setTimeout(tick, POLL);
    };
    tick();
    return () => clearTimeout(timer);
  }, [ecctrl]);

  // Glide towards the last known position so 2 s updates still look like walking.
  useFrame((_, delta) => {
    const blend = Math.min(1, delta * 4);
    for (const [id, group] of groups.current) {
      const target = targets.current.get(id);
      if (!target) continue;
      if (!group.userData.placed) {
        group.position.set(target.x, BODY, target.z);
        group.rotation.y = target.ry;
        group.userData.placed = true;
        continue;
      }
      group.position.x += (target.x - group.position.x) * blend;
      group.position.z += (target.z - group.position.z) * blend;
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
      <Avatar avatar={player.avatar || undefined} />
    </group>
  ));
}
