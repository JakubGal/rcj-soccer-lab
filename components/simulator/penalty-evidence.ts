import type * as PC from 'playcanvas';
import { penaltyEvidenceSegments } from '@/lib/simulator/referee-geometry';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
import type { Pose } from '@/lib/simulator/types';

/** Ground projection drawn over the robot so even a small overlap is visible. */
export function createPenaltyEvidence(pc: typeof PC, app: PC.Application) {
  const root = new pc.Entity('Penalty area body evidence');
  app.root.addChild(root);
  root.enabled = false;
  const layers = ['#e6f7ff', '#ff526b'].map((color) => {
    const material = new pc.StandardMaterial();
    material.useLighting = false;
    material.emissive.fromString(color);
    material.blendType = pc.BLEND_NORMAL;
    material.depthTest = false;
    material.depthWrite = false;
    material.cull = pc.CULLFACE_NONE;
    material.update();
    const entity = new pc.Entity('Projected body outline');
    entity.addComponent('render', {
      castShadows: false,
      receiveShadows: false,
    });
    root.addChild(entity);
    return { material, entity, mesh: null as PC.Mesh | null };
  });
  let last = '';
  return {
    set(enabled: boolean, poses: Record<string, Pose>, visual: RobotVisualId) {
      root.enabled = enabled;
      if (!enabled) return;
      const robots = Object.entries(poses).filter(([id]) => id !== 'ball');
      const key = JSON.stringify([visual, robots]);
      if (key === last) return;
      last = key;
      const data = layers.map(() => ({
        positions: [] as number[],
        indices: [] as number[],
      }));
      for (const [, pose] of robots)
        for (const segment of penaltyEvidenceSegments(pose, visual)) {
          const target = data[segment.inside ? 1 : 0];
          const [x, z] = segment.a,
            [u, v] = segment.b;
          const length = Math.hypot(u - x, v - z);
          if (length < 1e-8) continue;
          const width = segment.inside ? 0.0025 : 0.001;
          const nx = (-(v - z) / length) * width,
            nz = ((u - x) / length) * width;
          const offset = target.positions.length / 3;
          target.positions.push(
            x + nx,
            0.006,
            z + nz,
            x - nx,
            0.006,
            z - nz,
            u + nx,
            0.006,
            v + nz,
            u - nx,
            0.006,
            v - nz,
          );
          target.indices.push(
            offset,
            offset + 1,
            offset + 2,
            offset + 2,
            offset + 1,
            offset + 3,
          );
        }
      layers.forEach((layer, i) => {
        layer.entity.render!.meshInstances = [];
        layer.mesh?.destroy();
        layer.mesh = null;
        if (!data[i].indices.length) return;
        const geometry = new pc.Geometry();
        geometry.positions = data[i].positions;
        geometry.indices = data[i].indices;
        geometry.calculateNormals();
        const mesh = pc.Mesh.fromGeometry(app.graphicsDevice, geometry);
        layer.mesh = mesh;
        layer.entity.render!.meshInstances = [
          new pc.MeshInstance(mesh, layer.material),
        ];
      });
    },
    dispose() {
      for (const layer of layers) {
        layer.entity.render!.meshInstances = [];
        layer.mesh?.destroy();
        layer.material.destroy();
      }
      root.destroy();
    },
  };
}
