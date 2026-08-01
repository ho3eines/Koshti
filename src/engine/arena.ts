import * as THREE from 'three';
import { ARENAS, type ArenaDef, type ArenaId } from '../game/data/leagues';
import type { QualityProfile } from './quality';
import { clamp01 } from '../core/math';

/**
 * Arena builder — mat, cage of light, crowd, banners and rigging.
 * Every heavy element is instanced and quality-gated.
 */
export class Arena {
  readonly group = new THREE.Group();
  readonly def: ArenaDef;
  private q: QualityProfile;
  private disposables: Array<{ dispose(): void }> = [];
  private crowdMesh: THREE.InstancedMesh | null = null;
  private crowdPhase: Float32Array = new Float32Array(0);
  private crowdBase: Float32Array = new Float32Array(0);
  private dummy = new THREE.Object3D();
  private spotL!: THREE.SpotLight;
  private spotR!: THREE.SpotLight;
  private keyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private matMesh!: THREE.Mesh;
  private beams: THREE.Mesh[] = [];
  private time = 0;

  constructor(id: ArenaId, quality: QualityProfile) {
    this.def = ARENAS[id];
    this.q = quality;
    this.build();
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private build(): void {
    const { mood } = this.def;
    const q = this.q;

    // ------------------------------------------------------------- the mat
    const matRadius = 5.2;
    const matGeo = this.track(new THREE.CylinderGeometry(matRadius, matRadius, 0.12, 64));
    const matMat = this.track(
      new THREE.MeshStandardMaterial({
        color: mood.matColor,
        roughness: 0.86 - q.matReflection * 0.4,
        metalness: 0.02 + q.matReflection * 0.08,
      }),
    );
    this.matMesh = new THREE.Mesh(matGeo, matMat);
    this.matMesh.position.y = -0.06;
    this.matMesh.receiveShadow = q.shadows;
    this.group.add(this.matMesh);

    // Inner wrestling circle.
    const circleGeo = this.track(new THREE.RingGeometry(2.9, 3.05, 64));
    const circleMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xf5f5f5,
        roughness: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    const circle = new THREE.Mesh(circleGeo, circleMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.005;
    circle.receiveShadow = false;
    this.group.add(circle);

    // Central starting circle + zone contrast ring.
    const startGeo = this.track(new THREE.RingGeometry(0.85, 0.95, 48));
    const start = new THREE.Mesh(startGeo, circleMat);
    start.rotation.x = -Math.PI / 2;
    start.position.y = 0.006;
    this.group.add(start);

    const zoneGeo = this.track(new THREE.RingGeometry(4.05, 5.15, 64));
    const zoneMat = this.track(
      new THREE.MeshStandardMaterial({
        color: mood.canvasColor,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    const zone = new THREE.Mesh(zoneGeo, zoneMat);
    zone.rotation.x = -Math.PI / 2;
    zone.position.y = 0.004;
    zone.receiveShadow = q.shadows;
    this.group.add(zone);

    // ------------------------------------------------------------ platform
    const platGeo = this.track(new THREE.CylinderGeometry(6.6, 7.0, 0.55, 48));
    const platMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0e1118, roughness: 0.95, metalness: 0.1 }),
    );
    const platform = new THREE.Mesh(platGeo, platMat);
    platform.position.y = -0.4;
    platform.receiveShadow = q.shadows;
    this.group.add(platform);

    // Floor plane so the platform reads as sitting in a space.
    const floorGeo = this.track(new THREE.CircleGeometry(60, 32));
    const floorMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 1, metalness: 0 }),
    );
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.68;
    floor.receiveShadow = q.shadows;
    this.group.add(floor);

    // ------------------------------------------------------------ lighting
    const amb = new THREE.HemisphereLight(mood.keyColor, mood.fillColor, mood.ambient * 1.4);
    this.group.add(amb);

    this.keyLight = new THREE.DirectionalLight(mood.keyColor, 1.5);
    this.keyLight.position.set(5, 11, 5);
    if (q.shadows) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      const c = this.keyLight.shadow.camera;
      c.near = 1;
      c.far = 30;
      c.left = -9;
      c.right = 9;
      c.top = 9;
      c.bottom = -9;
      this.keyLight.shadow.bias = -0.0012;
      this.keyLight.shadow.normalBias = 0.022;
      this.keyLight.shadow.radius = q.softShadows ? 3 : 1;
    }
    this.group.add(this.keyLight);
    this.group.add(this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(mood.rimColor, 1.1);
    this.rimLight.position.set(-6, 7, -7);
    this.group.add(this.rimLight);

    if (q.maxLights >= 3) {
      this.spotL = new THREE.SpotLight(
        mood.keyColor,
        mood.spotIntensity * 22,
        26,
        Math.PI / 7,
        0.45,
        1.4,
      );
      this.spotL.position.set(-5.5, 10.5, -3);
      this.spotL.target.position.set(0, 0, 0);
      if (q.shadows && q.maxLights >= 4) {
        this.spotL.castShadow = true;
        this.spotL.shadow.mapSize.set(q.shadowMapSize / 2, q.shadowMapSize / 2);
        this.spotL.shadow.bias = -0.001;
      }
      this.group.add(this.spotL, this.spotL.target);

      this.spotR = new THREE.SpotLight(
        mood.rimColor,
        mood.spotIntensity * 16,
        26,
        Math.PI / 7,
        0.5,
        1.4,
      );
      this.spotR.position.set(5.5, 10.5, 3);
      this.spotR.target.position.set(0, 0, 0);
      this.group.add(this.spotR, this.spotR.target);
    }

    // ------------------------------------------------- volumetric-ish beams
    if (q.volumetricLights) {
      const beamGeo = this.track(new THREE.ConeGeometry(3.1, 11, 24, 1, true));
      for (let i = 0; i < 4; i++) {
        const beamMat = this.track(
          new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? mood.keyColor : mood.rimColor,
            transparent: true,
            opacity: 0.05,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        const beam = new THREE.Mesh(beamGeo, beamMat);
        const a = (i / 4) * Math.PI * 2 + 0.4;
        beam.position.set(Math.cos(a) * 5.5, 6.2, Math.sin(a) * 5.5);
        beam.rotation.z = Math.cos(a) * 0.32;
        beam.rotation.x = -Math.sin(a) * 0.32;
        this.beams.push(beam);
        this.group.add(beam);
      }
    }

    // ---------------------------------------------------------- the lights rig
    if (this.def.capacity > 0) {
      const trussMat = this.track(
        new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.6, metalness: 0.8 }),
      );
      const trussGeo = this.track(new THREE.TorusGeometry(7.2, 0.09, 6, 40));
      const truss = new THREE.Mesh(trussGeo, trussMat);
      truss.rotation.x = Math.PI / 2;
      truss.position.y = 9.4;
      this.group.add(truss);

      const lampGeo = this.track(new THREE.CylinderGeometry(0.17, 0.26, 0.4, 8));
      const lampMat = this.track(
        new THREE.MeshStandardMaterial({
          color: 0xfff4e0,
          emissive: 0xfff0d0,
          emissiveIntensity: 2.4,
          roughness: 0.4,
        }),
      );
      const lampCount = this.q.id === 'low' ? 8 : 18;
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampCount);
      for (let i = 0; i < lampCount; i++) {
        const a = (i / lampCount) * Math.PI * 2;
        this.dummy.position.set(Math.cos(a) * 7.2, 9.2, Math.sin(a) * 7.2);
        this.dummy.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4);
        this.dummy.updateMatrix();
        lamps.setMatrixAt(i, this.dummy.matrix);
      }
      lamps.instanceMatrix.needsUpdate = true;
      this.group.add(lamps);
      this.track(lampGeo);
    }

    this.buildCrowd();
    this.buildBanners();
  }

  private buildCrowd(): void {
    const q = this.q;
    if (q.crowdCount === 0 || this.def.capacity === 0) return;

    const count = Math.min(q.crowdCount, this.def.capacity);
    const geo =
      q.crowdDetail >= 2
        ? this.track(new THREE.CapsuleGeometry(0.19, 0.34, 3, 6))
        : this.track(new THREE.BoxGeometry(0.36, 0.66, 0.3));

    const material = this.track(
      new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: false }),
    );
    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;

    this.crowdPhase = new Float32Array(count);
    this.crowdBase = new Float32Array(count * 3);

    const palette = [0x2b3550, 0x3a2b4a, 0x1f3a3d, 0x4a2f2f, 0x2f2f2f, 0x3d3a2b, 0x263a52];
    const color = new THREE.Color();
    // Tiered bowl seating.
    const rings = q.crowdDetail >= 2 ? 14 : 9;
    let i = 0;
    for (let r = 0; r < rings && i < count; r++) {
      const radius = 9.2 + r * 1.35;
      const height = -0.2 + r * 0.72;
      const perRing = Math.min(count - i, Math.floor(18 + r * 9));
      for (let k = 0; k < perRing && i < count; k++, i++) {
        const a = (k / perRing) * Math.PI * 2 + r * 0.11;
        const jitterR = (Math.random() - 0.5) * 0.4;
        const x = Math.cos(a) * (radius + jitterR);
        const z = Math.sin(a) * (radius + jitterR);
        this.crowdBase[i * 3] = x;
        this.crowdBase[i * 3 + 1] = height;
        this.crowdBase[i * 3 + 2] = z;
        this.crowdPhase[i] = Math.random() * Math.PI * 2;

        this.dummy.position.set(x, height, z);
        this.dummy.rotation.set(0, -a + Math.PI / 2, 0);
        this.dummy.scale.setScalar(0.9 + Math.random() * 0.25);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);

        color.setHex(palette[Math.floor(Math.random() * palette.length)]);
        mesh.setColorAt(i, color);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.crowdMesh = mesh;
    this.group.add(mesh);

    // Bowl geometry behind the crowd so it doesn't float in a void.
    const bowlGeo = this.track(new THREE.CylinderGeometry(22, 9, 12, 32, 1, true));
    const bowlMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x0a0d14,
        roughness: 1,
        side: THREE.BackSide,
      }),
    );
    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.position.y = 4.5;
    this.group.add(bowl);
  }

  private buildBanners(): void {
    if (this.def.capacity === 0 || this.q.id === 'low') return;
    const geo = this.track(new THREE.PlaneGeometry(3.4, 0.62));
    const colors = [0xd94f3d, 0x2f6fd0, 0xf59e0b, 0x38a169];
    for (let i = 0; i < 6; i++) {
      const m = this.track(
        new THREE.MeshBasicMaterial({
          color: colors[i % colors.length],
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
        }),
      );
      const banner = new THREE.Mesh(geo, m);
      const a = (i / 6) * Math.PI * 2 + 0.3;
      banner.position.set(Math.cos(a) * 8.6, 1.5, Math.sin(a) * 8.6);
      banner.lookAt(0, 1.5, 0);
      this.group.add(banner);
    }
  }

  /** crowdIntensity 0..1 from the sim. */
  update(dt: number, crowdIntensity: number): void {
    this.time += dt;
    const q = this.q;

    if (this.crowdMesh) {
      const excite = clamp01(crowdIntensity);
      const amp = 0.06 + excite * 0.42;
      const speed = 3 + excite * 7;
      // Only re-write a slice per frame on weaker devices.
      const total = this.crowdMesh.count;
      const stride = q.crowdDetail >= 2 ? 1 : 2;
      const offset = q.crowdDetail >= 2 ? 0 : Math.floor(this.time * 60) % 2;
      for (let i = offset; i < total; i += stride) {
        const ph = this.crowdPhase[i];
        const bob = Math.sin(this.time * speed + ph) * amp;
        const x = this.crowdBase[i * 3];
        const y = this.crowdBase[i * 3 + 1];
        const z = this.crowdBase[i * 3 + 2];
        this.dummy.position.set(x, y + Math.max(0, bob), z);
        this.dummy.rotation.set(bob * 0.25, Math.atan2(-x, -z), 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.crowdMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.crowdMesh.instanceMatrix.needsUpdate = true;
    }

    // Lights pulse subtly with the crowd.
    const pulse = 1 + crowdIntensity * 0.22 + Math.sin(this.time * 2.1) * 0.03;
    this.keyLight.intensity = 1.5 * pulse;
    this.rimLight.intensity = 1.1 * (1 + crowdIntensity * 0.35);
    if (this.spotL) {
      this.spotL.intensity = this.def.mood.spotIntensity * 22 * pulse;
      this.spotL.position.x = -5.5 + Math.sin(this.time * 0.5) * 0.6;
      this.spotR.intensity = this.def.mood.spotIntensity * 16 * pulse;
      this.spotR.position.x = 5.5 + Math.cos(this.time * 0.43) * 0.6;
    }
    for (let i = 0; i < this.beams.length; i++) {
      const m = this.beams[i].material as THREE.MeshBasicMaterial;
      m.opacity = 0.035 + crowdIntensity * 0.06 + Math.sin(this.time * 1.7 + i) * 0.012;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.group.clear();
  }
}
