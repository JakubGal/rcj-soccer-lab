import type * as PC from 'playcanvas';
import type { DamageCue, DamagePlayback } from '@/lib/simulator/damage-effects';

/** A small pooled effect. Its clock never writes to actors or the match clock. */
export function createDamageEffects(pc: typeof PC, app: PC.Application) {
  const root = new pc.Entity('Robot damage effects');
  app.root.addChild(root);
  root.enabled = false;
  const materials: PC.StandardMaterial[] = [];
  const particle = (
    name: string,
    type: 'sphere' | 'cone' | 'box',
    color: string,
    glow: boolean,
  ) => {
    const material = new pc.StandardMaterial();
    material.diffuse.fromString(color);
    material.useLighting = !glow;
    if (glow) material.emissive.fromString(color);
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.update();
    materials.push(material);
    const entity = new pc.Entity(name);
    entity.addComponent('render', {
      type,
      castShadows: false,
      receiveShadows: false,
    });
    entity.render!.material = material;
    root.addChild(entity);
    return { entity, material };
  };
  const flash = particle('Damage burst', 'sphere', '#ffb638', true);
  const sparks = Array.from({ length: 12 }, (_, i) =>
    particle(`Spark ${i}`, 'box', '#ffe899', true),
  );
  const flames = Array.from({ length: 5 }, (_, i) =>
    particle(`Flame ${i}`, 'cone', i % 2 ? '#ffd15b' : '#ff6b20', true),
  );
  const smoke = Array.from({ length: 7 }, (_, i) =>
    particle(`Smoke ${i}`, 'sphere', '#737b87', false),
  );
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = media.matches;
  const motionChanged = () => {
    reduced = media.matches;
  };
  media.addEventListener('change', motionChanged);
  let cue: DamageCue | null = null;
  let elapsed = 0;
  let removedFor = 0;
  let playback: DamagePlayback | null = null;
  let savedLive: {
    cue: DamageCue | null;
    elapsed: number;
    removedFor: number;
    enabled: boolean;
  } | null = null;
  const alpha = (p: typeof flash, value: number) => {
    p.entity.enabled = value > 0.005;
    p.material.opacity = Math.max(0, value);
    p.material.update();
  };
  const update = (dt: number) => {
    if (!cue || !root.enabled) return;
    const removed = cue.removed;
    if (!playback) {
      elapsed += Math.min(dt, 0.05);
      if (cue.removed) removedFor += Math.min(dt, 0.05);
    }
    if (removedFor >= 1.25) {
      root.enabled = false;
      return;
    }
    const fade = 1 - removedFor / 1.25;
    const t = reduced ? 0 : elapsed;
    const burst = Math.max(0, 1 - elapsed / 0.45);
    alpha(flash, reduced || cue.removed ? 0 : burst * 0.8);
    flash.entity.setLocalPosition(0, 0.15, 0);
    flash.entity.setLocalScale(
      0.12 + elapsed * 0.6,
      0.12 + elapsed * 0.5,
      0.12 + elapsed * 0.6,
    );
    sparks.forEach((p, i) => {
      const angle = i * 2.39996;
      const travel = Math.min(elapsed, 1.1);
      alpha(p, reduced ? 0 : Math.max(0, 1 - elapsed / 1.1) * fade);
      p.entity.setLocalPosition(
        Math.cos(angle) * travel * 0.33,
        Math.max(
          0.025,
          0.14 + travel * (0.4 + (i % 3) * 0.1) - travel * travel * 0.65,
        ),
        Math.sin(angle) * travel * 0.33,
      );
      p.entity.setLocalScale(0.009, 0.025, 0.009);
      p.entity.setLocalEulerAngles(i * 37 + t * 190, i * 61, t * 120);
    });
    flames.forEach((p, i) => {
      const angle = i * 2.39996;
      const height =
        0.09 +
        (i % 3) * 0.03 +
        (reduced ? 0 : Math.sin(t * 9 + i * 1.7) * 0.025);
      alpha(p, (removed ? 0 : 0.85) * fade);
      p.entity.setLocalPosition(
        Math.cos(angle) * 0.036,
        0.13 + height / 2,
        Math.sin(angle) * 0.036,
      );
      p.entity.setLocalScale(0.065, height, 0.065);
      p.entity.setLocalEulerAngles(
        reduced ? 0 : Math.sin(t * 7 + i) * 12,
        0,
        reduced ? 0 : Math.cos(t * 6 + i) * 10,
      );
    });
    smoke.forEach((p, i) => {
      const age = reduced ? i / 7 : (t * 0.4 + i / 7) % 1;
      const diameter = 0.055 + age * 0.11;
      alpha(p, (reduced ? 0.18 : Math.sin(age * Math.PI) * 0.38) * fade);
      p.entity.setLocalPosition(
        Math.sin(i * 2.4 + age) * (0.02 + age * 0.05),
        0.2 + age * 0.35,
        Math.cos(i * 2.4) * 0.025,
      );
      p.entity.setLocalScale(diameter, diameter * 0.8, diameter);
    });
  };
  app.on('update', update);
  return {
    setCue(next: DamageCue | null, timing: DamagePlayback | null = null) {
      if (timing) {
        if (!savedLive)
          savedLive = { cue, elapsed, removedFor, enabled: root.enabled };
        playback = timing;
        cue = next;
        elapsed = timing.elapsed;
        removedFor = timing.removedFor;
        root.enabled = Boolean(next);
        if (next) root.setPosition(next.position.x, 0, next.position.z);
        update(0);
        return;
      }
      playback = null;
      if (savedLive) {
        ({ cue, elapsed, removedFor } = savedLive);
        root.enabled = savedLive.enabled;
        if (cue) root.setPosition(cue.position.x, 0, cue.position.z);
        savedLive = null;
      }
      if (!next) {
        cue = null;
        root.enabled = false;
        return;
      }
      if (next.id !== cue?.id) {
        elapsed = 0;
        removedFor = 0;
        root.enabled = true;
        root.setPosition(next.position.x, 0, next.position.z);
      }
      cue = { ...next, position: { ...next.position } };
      update(0);
    },
    dispose() {
      app.off('update', update);
      media.removeEventListener('change', motionChanged);
      root.destroy();
      materials.forEach((material) => material.destroy());
    },
  };
}
