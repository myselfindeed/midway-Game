import * as THREE from 'three';
import { createFighter, createDestroyer, createCarrier, createOcean, createSky, bindOceanDepth, updateFlameTime } from './models.js';
import { Terrain } from './world/Terrain.js';
import { loadHeightField } from './world/HeightField.js';
import { createEnvironment } from './render/Environment.js';
import { createFarRange } from './world/FarRange.js';
import { createClouds } from './world/Clouds.js';
import { createBlobShadow } from './render/BlobShadow.js';
import { createPostFX, isMobileGPU } from './render/PostFX.js';
import { getLevel } from './levels.js';

const CRUISE = 28;
const BOOST = 48;
const TURN = 1.55;
const FIRE_RATE = 0.09;
const BULLET_SPEED = 90;
const GUN_RANGE = 130;
const MISSILE_CD = 22;
const SHIELD_CD = 25;
const SHIELD_DURATION = 2;
const SHIELD_DR = 0.5;
const OPEN_RANGE = CRUISE * 12;
const CONE = THREE.MathUtils.degToRad(120);
const APPROACH = 14;
/**
 * 舰船锁定：准星的"屏幕就近"规则是按同高度缠斗调的（目标要投进准星 48px 窗口），
 * 对贴着海面的舰船永远差几十像素——实测 300 单位距离 dy≈87px，锁定恒为 null，
 * 地狱火的对舰加成等于白写。舰船改成机头指向判定：指向即锁定。
 */
const SHIP_LOCK_RANGE = 380;
const SHIP_TRACK_RANGE = 900;
const SHIP_LOCK_COS = 0.82;   // 约 ±35° 锥角

/**
 * 能量体的颜色要超过 1.0 才会被 bloom 抓走。
 * 这里不做"更亮的颜色"，而是把线性值直接推过 1：渲染到 HDR 缓冲时原样保留，
 * 后期按亮度阈值挑出来做辉光。系数是按"机身中性灰 ≈0.25、子弹 ≈3"标定的。
 */
function hdr(hex, mul) {
  return new THREE.Color(hex).multiplyScalar(mul);
}

export class Game {
  constructor(canvas, input, ui) {
    this.canvas = canvas;
    this.input = input;
    this.ui = ui;
    this.running = false;
    this.paused = false;

    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 30000);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    // 移动端 GPU 带宽有限：后期要额外几张大图，2× 上限会把显存和填充率吃穿
    this.dprCap = isMobileGPU() ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprCap));
    this.renderer.setClearColor(0x4ea0ea);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // ACES 内部会先乘 1/0.6（≈1.67）再走曲线，等于偷偷加了曝光。
    // 接上后期后画面立刻"洗白"，就是这一步没补偿。0.8 让中间调回到原来的密度，
    // 亮部交给 bloom 单独提亮——这才是参考图那种"暗处有细节、亮处会发光"的关系。
    this.renderer.toneMappingExposure = 0.62;

    this.sky = createSky();
    this.sky.renderOrder = -1000;   // 天空先画（不写深度），远山与地形再覆盖
    this.scene.add(this.sky);
    // 天空 → IBL 环境贴图 + 太阳自阴影 + 统一指数雾（原先只有平掉一切的半球光）
    this.env = createEnvironment(this.scene, this.renderer, this.sky);
    this.farRange = createFarRange(0xc3dae7);
    this.scene.add(this.farRange);
    this.clouds = createClouds();
    this.scene.add(this.clouds.group);
    this.ocean = createOcean();
    this.scene.add(this.ocean);
    this.terrain = null;

    // Bloom：场景改走「HDR 离屏 → 亮部辉光 → 统一色调映射」，
    // 太阳、海面反光、尾焰才有真正的溢出感（见 PostFX.js 注释）
    this.postfx = createPostFX(this.renderer, this.scene, this.camera);

    this.player = {
      mesh: createFighter(0x4aa3ff, false),
      hp: 100,
      maxHp: 100,
      yaw: 0,
      pitch: 0,
      speed: CRUISE,
      fireCd: 0,
      missileCd: 0,
      shieldCd: 0,
      shieldT: 0,
      invuln: 0,
    };
    this.player.mesh.position.set(0, 46, 40);
    this.scene.add(this.player.mesh);

    this.shieldMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vPos;
        void main() {
          float lat = abs(fract(vPos.y * 1.7 + uTime * 0.35) - 0.5);
          float lon = abs(fract(vPos.x * 1.5 - uTime * 0.22) - 0.5);
          float net = smoothstep(0.07, 0.0, min(lat, lon));
          float flow = smoothstep(0.55, 1.0, sin(vPos.y * 9.0 - uTime * 7.5) * sin(vPos.x * 7.0 + uTime * 5.0));
          float arc = smoothstep(0.82, 1.0, sin(vPos.z * 16.0 + uTime * 18.0));
          float a = net * (0.28 + flow * 0.85) + arc * 0.75;
          vec3 col = mix(vec3(0.25, 0.85, 1.0), vec3(0.9, 1.0, 1.0), max(flow, arc));
          // ×2.4 推到 HDR，护盾的流动网纹才会自己发光（加色混合 + bloom）
          gl_FragColor = vec4(col * 2.4, a);
        }
      `,
    });
    this.shieldAura = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(2.45, 28, 18), this.shieldMat);
    const net = new THREE.Mesh(
      new THREE.SphereGeometry(2.48, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x8af4ff, wireframe: true, transparent: true, opacity: 0.4 })
    );
    this.shieldAura.add(shell);
    this.shieldAura.add(net);
    this.shieldAura.visible = false;
    this.player.mesh.add(this.shieldAura);

    this.enemies = [];
    this.ships = [];
    this.bullets = [];
    this.missiles = [];
    this.explosions = [];
    this.locked = null;
    this.spawnFleet();

    this.levelId = 1;
    this.level = getLevel(1);
    /** 关卡 2 里需要守护的己方航母；不在 this.ships 里，避免被锁定/误伤 */
    this.base = null;
    this.shipKills = 0;
    this.shipTarget = 0;
    /** 关卡 4/5：击落的护航机数（阶段 A 突破计数） */
    this.fleetKills = 0;
    /** 关卡 4/5：击沉的敌航母数（阶段 A 的 sinks 判定只数航母） */
    this.carrierKills = 0;
    /** 关卡 3/4/5：补兵计时 */
    this._refillT = 0;

    this.phase = 'A';
    this.kills = 0;
    this.killTarget = 6;
    this.checkpoint = 'start';
    this.ended = false;
    this.elapsed = 0;
    this._raf = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.initTerrain();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    // 跨屏拖动/浏览器缩放时 devicePixelRatio 会变，后期缓冲要跟着重建，
    // 否则 composer 还在按旧比例算尺寸，画面会被拉伸
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    if (Math.abs(this.renderer.getPixelRatio() - dpr) > 1e-3) {
      this.renderer.setPixelRatio(dpr);
      this.postfx.setPixelRatio(dpr);
    }
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h);
  }

  /**
   * 切关卡：清干净上一关的所有场景物（敌机/弹丸/舰船/己方编队），
   * 再按新关卡的配置重建。关卡可以反复切换，所以这里必须是幂等的。
   */
  applyLevel(id) {
    const level = getLevel(id);
    this.levelId = level.id;
    this.level = level;
    this.clearCombatants();
    this.clearFleet();
    if (this.base) {
      this.scene.remove(this.base.mesh);
      this.base = null;
    }
    this.phase = 'A';
    this.checkpoint = 'start';
    this.kills = 0;
    this.killTarget = level.strike?.total ?? 6;
    this.shipKills = 0;
    this.shipTarget = level.escort?.count ?? 0;
    this.fleetKills = 0;
    this.carrierKills = 0;
    this._refillT = 0;
    this.locked = null;
    this.elapsed = 0;
    this.ended = false;
    this.ui.setMission('', '', true);
  }

  resetToCheckpoint() {
    const level = this.level;
    this.ended = false;
    // 关卡 3 是存活计时关：检查点重试时倒计时要从 cpAt 继续，而不是从 0 或旧值
    if (this.levelId === 3) {
      this.elapsed = this.checkpoint === 'cp1' ? level.survive.cpAt : 0;
    } else if (this.checkpoint === 'start') {
      this.elapsed = 0;
    }
    this.clearCombatants();
    this.player.hp = this.player.maxHp;
    this.player.yaw = level.start.yaw;
    this.player.pitch = 0;
    this.player.speed = CRUISE;
    this.player.fireCd = 0;
    this.player.missileCd = 0;
    this.player.shieldCd = 0;
    this.player.shieldT = 0;
    this.player.invuln = 1.2;
    this.player.mesh.position.set(level.start.x, level.start.y, level.start.z);
    this.player.mesh.rotation.order = 'YXZ';
    this.player.mesh.rotation.set(0, level.start.yaw, 0);
    this.locked = null;

    this.clearFleet();
    this.fleetKills = 0;
    this.carrierKills = 0;
    this._refillT = 0;
    this.shipKills = 0;

    const cp1 = this.checkpoint === 'cp1';
    if (this.levelId === 2) {
      this.spawnBase();
      if (cp1) {
        this.phase = 'B';
        this.kills = this.killTarget;
        this.spawnEscortGroup();
      } else {
        this.phase = 'A';
        this.kills = 0;
        this.spawnStrikeWave();
      }
    } else if (this.levelId === 3) {
      // 存活关：只按当前阶段补满一波敌机，推进交给 update() 的倒计时
      this.phase = cp1 ? 'B' : 'A';
      const cap = this.phase === 'A' ? level.survive.capA : level.survive.capB;
      this.spawnWave(this.phase, cap);
    } else if (this.levelId === 4 || this.levelId === 5) {
      this.spawnCarrierGroup();
      if (cp1) {
        this.phase = 'B';
        const pa = level.fleet.phaseA;
        this.fleetKills = pa.kills || 0;
        this.carrierKills = pa.sinks || 0;
      } else {
        this.phase = 'A';
      }
      this.spawnFleetEscorts();
    } else {
      // 关卡 1
      this.spawnFleet();
      if (cp1) {
        this.phase = 'B';
        this.kills = 6;
        this.killTarget = 12;
        this.spawnWave('B');
      } else {
        this.phase = 'A';
        this.kills = 0;
        this.killTarget = 6;
        this.spawnWave('A');
      }
    }
    this.syncMission(true);
    this.ui.updateHp(this.player.hp, this.player.maxHp);
  }

  spawnFleet() {
    this.clearFleet();

    const carrier = {
      kind: 'carrier',
      mesh: createCarrier(),
      hp: 400,
      maxHp: 400,
      radius: 40,
      fireCd: 2.5,
      aaDamage: 6,
    };
    carrier.mesh.position.set(0, -18, -110);
    this.ships.push(carrier);
    this.scene.add(carrier.mesh);

    const escorts = [
      { x: -32, z: -78 },
      { x: 36, z: -88 },
    ];
    for (const p of escorts) {
      const d = {
        kind: 'destroyer',
        mesh: createDestroyer(),
        hp: 160,
        maxHp: 160,
        radius: 10,
        fireCd: 1.2 + Math.random(),
        aaDamage: 9,
      };
      d.mesh.position.set(p.x, -18, p.z);
      this.ships.push(d);
      this.scene.add(d.mesh);
    }
  }

  clearFleet() {
    for (const s of this.ships) this.scene.remove(s.mesh);
    this.ships.length = 0;
  }

  /**
   * 关卡 2 的"基地"：己方航母编队。
   * 复用同一份 carrier.glb（画风/模型不动），只是不放进 this.ships，
   * 所以它不会被玩家锁定、不会被导弹误伤，只吃来袭敌机的投弹。
   */
  spawnBase() {
    const b = this.level.base;
    const hp = b.hp;
    const carrier = {
      kind: 'carrier',
      friendly: true,
      mesh: createCarrier(),
      hp,
      maxHp: hp,
      radius: b.radius,
    };
    carrier.mesh.position.set(b.x, b.y, b.z);
    carrier.hitCenter = new THREE.Vector3(b.x, b.y + 12, b.z);
    this.base = carrier;
    this._baseWarned = false;
    this.scene.add(carrier.mesh);
    this.ui.setMission('', '', true);
  }

  /**
   * 关卡 2 阶段 A：来袭的敌机从外海扑向航母。
   * 它们不追玩家（role='strike'），只在抵近后绕舰投弹——玩家必须主动去拦。
   */
  spawnStrikeWave(count = this.level.strike?.waveSize ?? 2) {
    const S = this.level.strike;
    const b = this.level.base;
    if (!S || !b) return;
    for (let i = 0; i < count; i++) {
      const mesh = createFighter(0xc44a4a, true);
      const spread = (i - (count - 1) / 2) * 150;
      mesh.position.set(
        b.x + spread + (Math.random() - 0.5) * 40,
        58 + Math.random() * 10,
        b.z + 620 - i * 45
      );
      mesh.lookAt(b.x, 30, b.z);
      mesh.rotateY(Math.PI);
      const enemy = {
        mesh,
        hp: S.hp,
        maxHp: S.hp,
        role: 'strike',
        damage: S.damage,
        fireCd: 3 + Math.random() * 2,
        t: Math.random() * 6,
      };
      this.enemies.push(enemy);
      this.scene.add(mesh);
    }
  }

  /** 关卡 2 阶段 B：从外海压上来的敌驱逐舰（沿用现有 destroyer 网格） */
  spawnEscortGroup() {
    const E = this.level.escort;
    const b = this.level.base;
    if (!E || !b) return;
    for (let i = 0; i < E.count; i++) {
      const p = E.spawn[i] || { x: (i - 0.5) * 300, z: 240 };
      const ship = {
        kind: 'destroyer',
        mesh: createDestroyer(),
        hp: E.hp,
        maxHp: E.hp,
        radius: 10,
        fireCd: 1.2 + Math.random(),
        aaDamage: 9,
        speed: E.speed,
        target: new THREE.Vector3(b.x, b.y, b.z),
      };
      ship.mesh.position.set(p.x, -18, p.z);
      ship.mesh.lookAt(b.x, -18, b.z);
      ship.mesh.rotateY(Math.PI);
      this.ships.push(ship);
      this.scene.add(ship.mesh);
    }
  }

  aliveShips() {
    return this.ships.filter((s) => s.hp > 0);
  }

  aliveCarriers() {
    return this.ships.filter((s) => s.kind === 'carrier' && s.hp > 0);
  }

  aliveDestroyers() {
    return this.ships.filter((s) => s.kind === 'destroyer' && s.hp > 0);
  }

  /**
   * 关卡 4/5：布置敌军航母群 + 护航驱逐舰。
   * 航母是敌舰（放在 this.ships，可被锁定/击沉），带 spawn 参数表示会定期产护航机。
   */
  spawnCarrierGroup() {
    const L = this.level.fleet;
    const nc = L.carriers.length;
    L.carriers.forEach((cc, i) => {
      const carrier = {
        id: `cv${i}`,
        kind: 'carrier',
        mesh: createCarrier(),
        hp: cc.hp,
        maxHp: cc.hp,
        radius: 40,
        fireCd: 2.5,
        aaDamage: 6,
        spawn: cc.spawn
          ? { interval: cc.spawn.interval, cap: cc.spawn.cap, fromPhase: cc.spawn.fromPhase || 'B' }
          : null,
        spawnCd: 4 + Math.random() * 2,
      };
      // 横排，越靠边的越靠里（略呈 V 字），都朝外海 -Z 方向
      const x = (i - (nc - 1) / 2) * 140;
      carrier.mesh.position.set(x, -18, -300 - Math.abs(i - (nc - 1) / 2) * 70);
      this.ships.push(carrier);
      this.scene.add(carrier.mesh);
    });
    const nd = L.destroyers.length;
    L.destroyers.forEach((dd, i) => {
      const d = {
        kind: 'destroyer',
        mesh: createDestroyer(),
        hp: dd.hp,
        maxHp: dd.hp,
        radius: 10,
        fireCd: 1.2 + Math.random(),
        aaDamage: 9,
      };
      const x = (i - (nd - 1) / 2) * 120;
      d.mesh.position.set(x, -18, -210);
      this.ships.push(d);
      this.scene.add(d.mesh);
    });
  }

  /** 关卡 4/5：初始护航机波次（阶段 A 的拦截目标） */
  spawnFleetEscorts() {
    const pa = this.level.fleet.phaseA;
    const n = pa.initial || 0;
    if (n > 0) this.spawnWave(this.phase, n);
  }

  /**
   * 航母产的一架护航机：从航母上空起飞，作为 intercept 敌机追玩家。
   * 打上 carrierId，用于"单舰同屏上限"的计数。
   */
  spawnCarrierPlane(carrier) {
    const hp = this.level.fleet.phaseA.hp || 28;
    const mesh = createFighter(0xc44a4a, true);
    mesh.position.set(
      carrier.mesh.position.x + (Math.random() - 0.5) * 40,
      52 + Math.random() * 12,
      carrier.mesh.position.z + (Math.random() - 0.5) * 40
    );
    const enemy = {
      mesh,
      hp,
      maxHp: hp,
      role: 'intercept',
      carrierId: carrier.id,
      slot: 0,
      hold: OPEN_RANGE,
      t: Math.random() * Math.PI * 2,
      fireCd: 5 + Math.random() * 2,
    };
    this.enemies.push(enemy);
    this.scene.add(mesh);
  }

  /** 关卡 4/5：航母定期产护航机（阶段限制 + 单舰上限 + 全局上限），击沉即停 */
  updateCarrierSpawning(dt) {
    const L = this.level.fleet;
    if (!L) return;
    for (const c of this.aliveCarriers()) {
      if (!c.spawn) continue;
      // 阶段门槛：关卡 4 阶段 B 才开始产兵，关卡 5 阶段 A 就产
      if (this.phase === 'A' && c.spawn.fromPhase !== 'A') continue;
      const mine = this.enemies.filter((e) => e.carrierId === c.id).length;
      if (mine >= c.spawn.cap) continue;
      if (this.enemies.length >= L.escortCap) continue;
      c.spawnCd -= dt;
      if (c.spawnCd <= 0) {
        this.spawnCarrierPlane(c);
        c.spawnCd = c.spawn.interval;
      }
    }
  }

  lockTargets() {
    return [...this.enemies, ...this.aliveShips()];
  }

  /** 地形按玩家位置流式维护（内部处理 LOD 与回收）；海面由 createOcean 兜底 */
  updateLand() {
    if (this.terrain) this.terrain.update(this.player.mesh.position);
  }

  /** 异步加载高度场；失败则回退为纯海面，不影响开局 */
  async initTerrain() {
    try {
      const field = await loadHeightField('assets/terrain/height.png', 'assets/terrain/height.json');
      this.terrain = new Terrain(this.scene, field, { radius: 4 });
      this.terrain.update(this.player.mesh.position);
      bindOceanDepth(this.ocean, field);   // 海面据此计算水深与岸线
      // 地形着色器不接收 shadowMap，用一块乘算软影补上"落地感"
      this.blobShadow = createBlobShadow(field, { size: 10 });
      this.scene.add(this.blobShadow.mesh);
      console.info('[小宝特工空战] 地形就绪', field.meta.actualRange, '陆地占比见烘焙日志');
    } catch (err) {
      console.warn('[小宝特工空战] 地形加载失败，回退为纯海面', err);
    }
  }

  updateShipBillboards() {
    if (!this.clouds) return;
    this.clouds.update(this.player.mesh.position, this.camera, this._dt || 0.016);
  }

  startLevel(id = this.levelId) {
    this.applyLevel(id);
    this.resetToCheckpoint();
    this.running = true;
    this.paused = false;
    this.clock.start();
    // loop() 会在每帧开头重新排下一帧，重复调用会叠出两条 RAF 循环（速度翻倍）。
    // 切关卡/再来一次都走这里，所以先掐掉可能还在跑的那一条。
    cancelAnimationFrame(this._raf);
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  setPaused(v) {
    this.paused = v;
    if (!v && this.running) this.clock.getDelta();
  }

  clearCombatants(keepPlayer = true) {
    for (const e of this.enemies) this.scene.remove(e.mesh);
    this.enemies.length = 0;
    for (const b of this.bullets) this.scene.remove(b.mesh);
    this.bullets.length = 0;
    for (const m of this.missiles) this.scene.remove(m.mesh);
    this.missiles.length = 0;
    for (const x of this.explosions) this.scene.remove(x.mesh);
    this.explosions.length = 0;
    if (!keepPlayer) {
      /* player stays */
    }
  }

  playerForward() {
    const yaw = this.player.yaw;
    return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  spawnWave(phase, count = 1) {
    const origin = this.player.mesh.position;
    const fwd = this.playerForward();
    const half = CONE * 0.5;
    for (let i = 0; i < count; i++) {
      const slot = count === 1 ? 0 : -half + (i / (count - 1)) * CONE;
      const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), slot);
      const mesh = createFighter(0xc44a4a, true);
      mesh.position.set(
        origin.x + dir.x * OPEN_RANGE,
        origin.y + (i - (count - 1) / 2) * 1.8,
        origin.z + dir.z * OPEN_RANGE
      );
      mesh.lookAt(origin.x, origin.y, origin.z);
      mesh.rotateY(Math.PI);
      const enemy = {
        mesh,
        hp: phase === 'A' ? 28 : 36,
        maxHp: phase === 'A' ? 28 : 36,
        role: 'intercept',
        slot,
        hold: OPEN_RANGE,
        t: Math.random() * Math.PI * 2,
        fireCd: 6 + Math.random() * 2,
      };
      this.enemies.push(enemy);
      this.scene.add(mesh);
    }
  }

  loop = () => {
    this._raf = requestAnimationFrame(this.loop);
    if (!this.running || this.paused) {
      this.ui.setEngine(false);
      this.postfx.render();
      return;
    }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._dt = dt;
    this.elapsed += dt;
    if (this.ocean?.material?.uniforms?.uTime) {
      this.ocean.material.uniforms.uTime.value = this.elapsed;
      this.ocean.material.uniforms.uCam.value.copy(this.camera.position);
    }
    this.update(dt);
    this.postfx.render(dt);
  };

  update(dt) {
    this.updatePlayer(dt);
    updateFlameTime(this.elapsed);   // 尾焰马赫环的流动相位
    this.updateLand();
    this.updateShipBillboards();
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateExplosions(dt);
    this.updateCamera(dt);
    if (this.env) this.env.update(this.player.mesh.position);
    if (this.terrain && this.terrain.materialUniforms) {
      this.terrain.materialUniforms.uCloudTime.value = this.elapsed;
    }
    if (this.blobShadow && this.terrain) {
      this.blobShadow.update(
        this.player.mesh.position,
        this.terrain.heightAt(this.player.mesh.position.x, this.player.mesh.position.z)
      );
    }
    this.updateAim();
    this.ui.updateCds(this.player.missileCd, this.player.shieldCd, MISSILE_CD, SHIELD_CD);
    this.ui.updateHp(this.player.hp, this.player.maxHp);
    this.ui.updateFlight(this.player.speed, this.player.mesh.position.y, this.elapsed);
    this.ui.setEngine(true, this.player.speed);

    this.updateLevelScript(dt);

    if (!this.ended && this.player.hp <= 0) {
      this.ended = true;
      this.running = false;
      this.ui.onDefeat(this.checkpoint, 'player', this.level);
    }
  }

  /**
   * 关卡专属的每帧推进（倒计时 / 补兵 / 航母产兵）。
   * 战斗、弹丸、相机这些通用逻辑都已在 update() 前面处理过。
   */
  updateLevelScript(dt) {
    if (this.ended) return;

    if (this.levelId === 3) {
      const sv = this.level.survive;
      const left = sv.duration - this.elapsed;
      if (left <= 0) {
        this.finishLevel();
        return;
      }
      if (this.phase === 'A' && this.elapsed >= sv.cpAt) {
        this.checkpoint = 'cp1';
        this.phase = 'B';
        this.ui.onCheckpoint(this.level.checkpointLine);
      }
      this._refillT += dt;
      const interval = this.phase === 'A' ? sv.refillA : sv.refillB;
      const cap = this.phase === 'A' ? sv.capA : sv.capB;
      if (this._refillT >= interval) {
        this._refillT = 0;
        const need = cap - this.enemies.length;
        if (need > 0) this.spawnWave(this.phase, need);
      }
      this.syncMission();
      return;
    }

    if (this.levelId === 4 || this.levelId === 5) {
      this.updateCarrierSpawning(dt);
      // 阶段 A：护航机波次被清空后按时补到 initial 架
      const pa = this.level.fleet.phaseA;
      if (this.phase === 'A' && pa.initial) {
        this._refillT += dt;
        if (this._refillT >= (pa.refill || 12)) {
          this._refillT = 0;
          if (this.enemies.length < pa.initial) this.spawnWave(this.phase, 1);
        }
      }
      this.syncMission();
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    const ax = this.input.axis.x;
    const ay = this.input.axis.y;

    p.yaw -= ax * TURN * dt;
    p.pitch = THREE.MathUtils.clamp(p.pitch - ay * TURN * 0.85 * dt, -0.55, 0.55);

    p.speed = this.input.boosting ? BOOST : CRUISE;
    const forward = new THREE.Vector3(
      -Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      -Math.cos(p.yaw) * Math.cos(p.pitch)
    );
    p.mesh.position.addScaledVector(forward, p.speed * dt);
    // 软地板：海面 -8 与地形 +7 取高者，撞地前平滑拉起（不做硬碰撞）
    const groundY = this.terrain ? this.terrain.heightAt(p.mesh.position.x, p.mesh.position.z) : -Infinity;
    const floor = Math.max(-8, groundY + 7);
    if (p.mesh.position.y < floor) {
      const depth = floor - p.mesh.position.y;
      p.mesh.position.y += depth * Math.min(1, dt * 3.2);
    }
    if (p.mesh.position.y < -15) p.mesh.position.y = -15;
    if (this.ocean) {
      this.ocean.position.x = p.mesh.position.x;
      this.ocean.position.z = p.mesh.position.z;
    }
    p.mesh.rotation.order = 'YXZ';
    p.mesh.rotation.y = p.yaw;
    p.mesh.rotation.x = p.pitch;
    p.mesh.rotation.z = THREE.MathUtils.clamp(-ax * 0.45, -0.5, 0.5);

    p.fireCd = Math.max(0, p.fireCd - dt);
    p.missileCd = Math.max(0, p.missileCd - dt);
    p.shieldCd = Math.max(0, p.shieldCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    if (p.shieldT > 0) {
      p.shieldT = Math.max(0, p.shieldT - dt);
      this.shieldAura.visible = true;
      this.shieldMat.uniforms.uTime.value = this.elapsed;
    } else {
      this.shieldAura.visible = false;
    }

    if (this.input.firing && p.fireCd <= 0) {
      this.spawnBullet(p.mesh, forward, true, 12);
      p.fireCd = FIRE_RATE;
      this.ui.playSfx('shoot');
    }

    if (this.input.consumeMissile() && p.missileCd <= 0 && this.locked) {
      this.spawnMissile(this.locked);
      p.missileCd = MISSILE_CD;
      this.ui.playSfx('missile');
    }

    if (this.input.consumeShield() && p.shieldCd <= 0) {
      p.shieldT = SHIELD_DURATION;
      p.shieldCd = SHIELD_CD;
      this.ui.playSfx('shield');
    }

    this.ui.setSkillDisabled(p.missileCd > 0, p.shieldCd > 0);

    const exhaust = p.mesh.getObjectByName('exhaust');
    if (exhaust) {
      // 巡航时只留一小截火苗，加力时明显拉长——两者差距本身就是"加速"的反馈
      const boost = this.input.boosting ? 1.5 : 0.72;
      const pulse = 0.82 + Math.sin(performance.now() * 0.02) * 0.18;
      exhaust.scale.set(boost, boost, boost * pulse);
    }
  }

  updateAim() {
    const origin = this.player.mesh.position;
    // 敌机：屏幕就近 + 投进准星窗口
    let best = null;
    let bestDist = GUN_RANGE;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dist = e.mesh.position.distanceTo(origin);
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    const self = this.projectScreen(origin);
    const lead = { x: self.x, y: Math.max(72, self.y - 210) };

    // 舰船：机头指向判定（见顶部常量注释）。跟踪箭头负责把玩家引向目标。
    let ship = null;
    let shipDist = SHIP_TRACK_RANGE;
    let shipDir = null;
    const fwd = this.playerForward();
    for (const s of this.aliveShips()) {
      const to = s.mesh.position.clone().sub(origin);
      const dist = to.length();
      if (dist > shipDist) continue;
      to.multiplyScalar(1 / dist);
      if (fwd.dot(to) < -0.2) continue;   // 只排除明确在身后的
      shipDist = dist;
      shipDir = to;
      ship = s;
    }

    if (!best && !ship) {
      this.locked = null;
      this.ui.setAim({ state: 'idle', frameX: lead.x, frameY: lead.y });
      return;
    }

    if (best) {
      // 空中有敌机时优先缠斗：敌机是直接威胁，舰船跑不掉
      const projected = this.projectScreen(best.mesh.position);
      const inside = projected.inFront
        && Math.abs(projected.x - lead.x) < 48
        && Math.abs(projected.y - lead.y) < 48;
      if (inside) {
        this.locked = best;
        this.ui.setAim({ state: 'aimed', frameX: lead.x, frameY: lead.y });
      } else {
        this.locked = null;
        this.ui.setAim({
          state: 'track',
          frameX: lead.x,
          frameY: lead.y,
          x: projected.x,
          y: projected.y,
          behind: !projected.inFront,
        });
      }
      return;
    }

    const projected = this.projectScreen(ship.mesh.position);
    if (shipDist <= SHIP_LOCK_RANGE && fwd.dot(shipDir) > SHIP_LOCK_COS) {
      this.locked = ship;
      this.ui.setAim({ state: 'aimed', frameX: lead.x, frameY: lead.y });
    } else {
      this.locked = null;
      this.ui.setAim({
        state: 'track',
        frameX: lead.x,
        frameY: lead.y,
        x: projected.x,
        y: projected.y,
        behind: !projected.inFront,
      });
    }
  }

  projectScreen(world) {
    const camFwd = new THREE.Vector3();
    this.camera.getWorldDirection(camFwd);
    const to = world.clone().sub(this.camera.position);
    const inFront = camFwd.dot(to) > 0;
    const ndc = world.clone().project(this.camera);
    // 用 canvas 的布局尺寸（clientWidth/Height），而非 getBoundingClientRect：
    // 竖屏锁定横放时 #app 整体 rotate 90°，getBoundingClientRect 返回的是旋转后的
    // 轴对齐包围盒（宽高对调），用它算坐标会跟"游戏画面坐标系"差 90°，导致瞄准框错位。
    // clientWidth/Height 是布局尺寸，始终与 HUD 的定位坐标系（#hud 与 canvas 同层）一致。
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    return {
      inFront,
      x: (ndc.x * 0.5 + 0.5) * w,
      y: (-ndc.y * 0.5 + 0.5) * h,
    };
  }

  /**
   * opts.base = true 表示这颗弹丸瞄的是己方编队（关卡 2 的敌机投弹），
   * 不再走"会不会打到玩家"那条判定。
   */
  spawnBullet(fromMesh, dir, fromPlayer, damage, opts = {}) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, fromPlayer ? 2.4 : 1.4, 5),
      new THREE.MeshBasicMaterial({ color: hdr(fromPlayer ? 0xe8fbff : 0xff6666, fromPlayer ? 3.2 : 2.2) })
    );
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.position.copy(fromMesh.position).addScaledVector(dir, 3.15);
    this.scene.add(mesh);
    this.bullets.push({
      mesh,
      vel: dir.clone().multiplyScalar(BULLET_SPEED),
      life: 1.6,
      fromPlayer,
      damage,
      targetBase: !!opts.base,
    });
  }

  spawnMissile(targetEnemy) {
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.9, 6),
      new THREE.MeshBasicMaterial({ color: hdr(0xffb347, 3.0) })
    );
    mesh.position.copy(this.player.mesh.position);
    this.scene.add(mesh);
    this.missiles.push({
      mesh,
      target: targetEnemy,
      speed: 70,
      life: 4,
      damage: 55,
    });
  }

  updateEnemies(dt) {
    const playerPos = this.player.mesh.position;
    for (const e of this.enemies) {
      if (e.role === 'strike') {
        this.updateStrikeEnemy(e, dt);
        continue;
      }
      e.t += dt;
      const toPlayer = playerPos.clone().sub(e.mesh.position);
      const dist = toPlayer.length();
      e.hold = Math.max(52, (e.hold ?? OPEN_RANGE) - APPROACH * dt);
      const dir = this.playerForward().applyAxisAngle(new THREE.Vector3(0, 1, 0), e.slot || 0);
      const desired = playerPos.clone().addScaledVector(dir, e.hold);
      desired.y = playerPos.y + Math.sin(e.t * 0.7) * 2.2;
      const toSlot = desired.sub(e.mesh.position);
      const gap = toSlot.length();
      if (gap > 0.2) {
        toSlot.multiplyScalar(1 / gap);
        const speed = THREE.MathUtils.clamp(gap * 1.25, 18, 40);
        e.mesh.position.addScaledVector(toSlot, speed * dt);
      }
      if (e.mesh.position.y < -12) e.mesh.position.y = -12;
      e.mesh.lookAt(playerPos);
      e.mesh.rotateY(Math.PI);
      e.fireCd -= dt;
      if (e.fireCd <= 0 && dist < 78) {
        const shot = playerPos.clone().sub(e.mesh.position);
        if (shot.lengthSq() > 0.01) {
          this.spawnBullet(e.mesh, shot.normalize(), false, 8);
          e.fireCd = 1.5 + Math.random() * 0.8;
        }
      }
    }

    this.updateFleetAI(dt);
  }

  /**
   * 关卡 2 的来袭敌机：先直线压向航母，抵近后绕舰盘旋投弹。
   * 侧向加一点正弦摆动，否则两架飞机会排成一条直线，看起来像轨迹动画。
   */
  updateStrikeEnemy(e, dt) {
    const base = this.base;
    if (!base || base.hp <= 0) return;
    const S = this.level.strike;
    const target = base.hitCenter;
    const toBase = target.clone().sub(e.mesh.position);
    const dist = toBase.length();
    e.t += dt;

    if (dist > S.orbit) {
      toBase.normalize();
      const side = new THREE.Vector3(-toBase.z, 0, toBase.x)
        .multiplyScalar(Math.sin(e.t * 0.6 + (e.seed ?? 0)) * 0.35);
      e.mesh.position.addScaledVector(toBase, S.speed * dt).addScaledVector(side, S.speed * dt);
    } else {
      // 绕到航母上空盘旋，保持一段距离投弹
      const ang = Math.atan2(e.mesh.position.x - target.x, e.mesh.position.z - target.z) + dt * 0.55;
      e.mesh.position.set(
        target.x + Math.sin(ang) * S.orbit,
        target.y + 34,
        target.z + Math.cos(ang) * S.orbit
      );
    }
    e.mesh.lookAt(target);
    e.mesh.rotateY(Math.PI);

    e.fireCd -= dt;
    if (e.fireCd <= 0 && dist < S.fireRange) {
      const shot = target.clone().sub(e.mesh.position);
      if (shot.lengthSq() > 0.01) {
        this.spawnBullet(e.mesh, shot.normalize(), false, S.damage, { base: true });
        e.fireCd = S.fireCd;
      }
    }
  }

  /** 舰船 AI：护航舰压向航母 + 防空火力（关卡 1 的编队原地不动） */
  updateFleetAI(dt) {
    const playerPos = this.player.mesh.position;
    for (const s of this.aliveShips()) {
      if (s.speed && s.target) {
        const toTarget = s.target.clone().sub(s.mesh.position);
        const gap = toTarget.length();
        // 停在航母外圈，不要真的贴上去把模型插进船体
        if (gap > 78) {
          toTarget.multiplyScalar(1 / gap);
          s.mesh.position.addScaledVector(toTarget, s.speed * dt);
        }
        s.mesh.lookAt(s.target.x, s.mesh.position.y, s.target.z);
        s.mesh.rotateY(Math.PI);
      }

      s.fireCd -= dt;
      const toPlayer = playerPos.clone().sub(s.mesh.position);
      const dist = toPlayer.length();
      const range = s.kind === 'carrier' ? 95 : 70;
      if (s.fireCd <= 0 && dist < range) {
        toPlayer.normalize();
        const muzzle = { position: s.mesh.position.clone() };
        muzzle.position.y = -12;
        this.spawnBullet(muzzle, toPlayer, false, s.aaDamage);
        s.fireCd = s.kind === 'carrier' ? 1.8 + Math.random() : 1.1 + Math.random() * 0.6;
      }
    }
  }

  hitRadius(target) {
    return target.radius || 2.2;
  }

  updateProjectiles(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      if (b.fromPlayer) {
        for (const e of this.lockTargets()) {
          if (b.mesh.position.distanceTo(e.mesh.position) < this.hitRadius(e)) {
            this.damageTarget(e, b.damage);
            hit = true;
            break;
          }
        }
      } else if (b.targetBase) {
        const base = this.base;
        if (base && base.hp > 0 && b.mesh.position.distanceTo(base.hitCenter) < base.radius) {
          this.damageBase(b.damage, b.mesh.position.clone());
          hit = true;
        }
      } else if (this.player.invuln <= 0 && b.mesh.position.distanceTo(this.player.mesh.position) < 1.5) {
        this.damagePlayer(b.damage);
        hit = true;
      }
      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      if (!m.target || m.target.hp <= 0) {
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
        continue;
      }
      const dir = m.target.mesh.position.clone().sub(m.mesh.position).normalize();
      m.mesh.position.addScaledVector(dir, m.speed * dt);
      m.mesh.lookAt(m.target.mesh.position);
      if (m.mesh.position.distanceTo(m.target.mesh.position) < this.hitRadius(m.target)) {
        // Hellfire bonus vs ships
        const bonus = m.target.kind === 'destroyer' || m.target.kind === 'carrier' ? 1.6 : 1;
        this.damageTarget(m.target, m.damage * bonus);
        this.spawnExplosion(m.target.mesh.position.clone());
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      } else if (m.life <= 0) {
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
  }

  /**
   * 把世界坐标换算成"听感"参数：左右声像 + 距离衰减。
   * 玩家听者就在相机上，唯一能分辨方位的就是左右，
   * 但只要有这一维，远处的爆炸就不会和身边的一样响，听感差别很大。
   */
  audioAt(pos, baseGain = 1) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const dx = pos.x - cam.position.x;
    const dy = pos.y - cam.position.y;
    const dz = pos.z - cam.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const m = cam.matrixWorld.elements;
    const pan = THREE.MathUtils.clamp((dx * m[0] + dy * m[1] + dz * m[2]) / dist, -1, 1) * 0.8;
    return { pan, gain: baseGain * Math.min(1, 260 / (260 + dist)) };
  }

  damageTarget(e, dmg) {
    if (e.kind === 'destroyer' || e.kind === 'carrier') {
      this.damageShip(e, dmg);
      return;
    }
    e.hp -= dmg;
    if (e.hp <= 0) {
      this.spawnExplosion(e.mesh.position.clone());
      this.scene.remove(e.mesh);
      const idx = this.enemies.indexOf(e);
      if (idx >= 0) this.enemies.splice(idx, 1);
      if (this.locked === e) this.locked = null;
      this.kills += 1;
      this.fleetKills += 1;   // 关卡 4/5 的护航机计数（其它关无影响）
      this.ui.playSfx('explode', this.audioAt(e.mesh.position, 1));
      this.syncMission(true);
      if (this.levelId === 2) this.checkLevel2();
      else if (this.levelId === 4 || this.levelId === 5) this.checkFleetLevel();
      else if (this.levelId !== 3) this.checkPhase();   // 关卡 3 存活关不计击杀推进
    }
  }

  damageShip(s, dmg) {
    if (s.hp <= 0) return;
    s.hp -= dmg;
    if (s.hp <= 0) {
      s.hp = 0;
      this.spawnExplosion(s.mesh.position.clone().setY(-16));
      this.spawnExplosion(s.mesh.position.clone().add(new THREE.Vector3(4, 1, -3)));
      this.scene.remove(s.mesh);
      if (this.locked === s) this.locked = null;
      // 舰船吨位大得多：同一段采样放慢 0.78 倍，听起来更沉、拖得更长
      this.ui.playSfx('explode', { ...this.audioAt(s.mesh.position, 1.15), rate: 0.78 });
      this.shipKills += 1;
      if (s.kind === 'carrier') this.carrierKills += 1;

      if (this.levelId === 2) {
        const left = this.shipTarget - this.shipKills;
        this.ui.flashSubtitle(left > 0 ? `驱逐舰击沉！还剩 ${left} 艘` : '逼近的驱逐舰全部击沉！', 2600);
        this.syncMission(true);
        if (this.shipKills >= this.shipTarget) this.finishLevel();
      } else if (this.levelId === 4 || this.levelId === 5) {
        const label = s.kind === 'carrier' ? '敌航母沉没！' : '驱逐舰击沉！';
        this.ui.flashSubtitle(label, 2400);
        this.syncMission(true);
        this.checkFleetLevel();
      } else {
        const label = s.kind === 'carrier' ? '航母重创沉没！' : '驱逐舰击沉！';
        this.ui.flashSubtitle(`${label}（关卡1额外战果，通关仍以击落敌机为准）`, 3200);
      }
    }
  }

  /** 己方编队挨弹：只掉编队装甲，不掉玩家血；打光即任务失败 */
  damageBase(dmg, at) {
    const b = this.base;
    if (!b || b.hp <= 0 || this.ended) return;
    b.hp = Math.max(0, b.hp - dmg);
    this.spawnExplosion((at || b.hitCenter).clone());
    const ratio = b.hp / b.maxHp;
    this.syncMission();
    if (ratio <= 0.5 && !this._baseWarned) {
      this._baseWarned = true;
      this.ui.flashSubtitle('编队装甲过半，敌机正在投弹！', 2600);
    }
    if (b.hp <= 0) {
      this.spawnExplosion(b.hitCenter.clone());
      this.spawnExplosion(b.hitCenter.clone().add(new THREE.Vector3(12, 2, -8)));
      this.scene.remove(b.mesh);
      this.ui.playSfx('explode', { ...this.audioAt(b.hitCenter, 1.3), rate: 0.70 });
      this.ended = true;
      this.running = false;
      this.ui.onDefeat(this.checkpoint, 'base', this.level);
    }
  }

  damagePlayer(dmg) {
    let d = dmg;
    if (this.player.shieldT > 0) d *= 1 - SHIELD_DR;
    this.player.hp = Math.max(0, this.player.hp - d);
    this.ui.playSfx('hit');
    this.player.invuln = 0.35;
  }

  checkPhase() {
    if (this.phase === 'A' && this.kills >= 6) {
      this.checkpoint = 'cp1';
      this.phase = 'B';
      this.killTarget = 12;
      this.ui.onCheckpoint(this.level.checkpointLine);
      this.spawnWave('B');
      this.syncMission(true);
    } else if (this.phase === 'B' && this.kills >= 12 && !this.ended) {
      this.finishLevel();
    } else if (!this.ended) {
      this.spawnWave(this.phase);
    }
  }

  /** 关卡 2 的阶段推进：拦满 8 架进检查点，转入反舰阶段 */
  checkLevel2() {
    if (this.ended || this.phase !== 'A') return;
    if (this.kills >= this.killTarget) {
      this.checkpoint = 'cp1';
      this.phase = 'B';
      this.shipKills = 0;
      this.ui.onCheckpoint(this.level.checkpointLine);
      this.spawnEscortGroup();
      this.syncMission(true);
    } else if (this.enemies.length === 0) {
      // 一波清空后再派下一波，保持同一时间最多两架在空
      const left = this.killTarget - this.kills;
      this.spawnStrikeWave(Math.min(this.level.strike.waveSize, left));
      this.syncMission(true);
    }
  }

  /** 关卡 4/5 的阶段推进：阶段 A 达成进检查点，阶段 B 清光舰队即胜利 */
  checkFleetLevel() {
    if (this.ended) return;
    const L = this.level.fleet;
    const pa = L.phaseA;
    if (this.phase === 'A') {
      const done = pa.kills ? this.fleetKills >= pa.kills : this.carrierKills >= pa.sinks;
      if (done) {
        this.checkpoint = 'cp1';
        this.phase = 'B';
        this.ui.onCheckpoint(this.level.checkpointLine);
        this.syncMission(true);
      }
    } else if (this.phase === 'B') {
      if (this.aliveShips().length === 0) this.finishLevel();
    }
  }

  finishLevel() {
    if (this.ended) return;
    this.ended = true;
    this.running = false;
    this.ui.onVictory(this.level);
  }

  /** 任务栏文案：五关的目标/副信息不同，统一从这里出 */
  syncMission(force = false) {
    if (this.levelId === 2) {
      const pct = this.base ? Math.round(Math.max(0, this.base.hp / this.base.maxHp) * 100) : 0;
      const armor = `航母装甲 ${pct}%`;
      if (this.phase === 'A') {
        this.ui.setMission(`拦截敌机 ${this.kills}/${this.killTarget}`, `阶段 A · 编队防空 · ${armor}`, force);
      } else {
        this.ui.setMission(`击沉敌驱逐舰 ${this.shipKills}/${this.shipTarget}`, `阶段 B · 反舰突击 · ${armor}`, force);
      }
      return;
    }
    if (this.levelId === 3) {
      const left = Math.max(0, this.level.survive.duration - this.elapsed);
      const mm = String(Math.floor(left / 60)).padStart(2, '0');
      const ss = String(Math.floor(left % 60)).padStart(2, '0');
      const sub =
        this.phase === 'A' ? `阶段 A · 牵制（已击落 ${this.kills}）` : `阶段 B · 牵制（已击落 ${this.kills}）`;
      this.ui.setMission(`牵制敌机 ${mm}:${ss}`, sub, force);
      return;
    }
    if (this.levelId === 4 || this.levelId === 5) {
      const carriers = this.aliveCarriers().length;
      const escorts = this.aliveDestroyers().length;
      if (this.phase === 'A') {
        const pa = this.level.fleet.phaseA;
        const main = pa.kills
          ? `突破护航 ${this.fleetKills}/${pa.kills}`
          : `击沉航母 ${this.carrierKills}/${pa.sinks}`;
        this.ui.setMission(main, `阶段 A · 航母群 ${carriers} 艘 · 驱逐舰 ${escorts} 艘`, force);
      } else {
        this.ui.setMission(`清剿舰队 · 航母 ${carriers} · 驱逐舰 ${escorts}`, '阶段 B · 俯冲打击', force);
      }
      return;
    }
    const sub =
      this.phase === 'A' ? '阶段 A · 侦察护航（海面有航母编队）' : '阶段 B · 扩大战果（可锁定舰船）';
    this.ui.setMission(`击落敌机 ${this.kills}/${this.killTarget}`, sub, force);
  }

  spawnExplosion(pos) {
    // 火球走加色混合 + HDR：叠加后会自然过曝成白色核心，
    // bloom 再把它撑成光晕，比单纯放大一个橙色球像爆炸得多
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 10, 8),
      new THREE.MeshBasicMaterial({
        color: hdr(0xffa54e, 2.4),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.explosions.push({ mesh, life: 0.45, age: 0 });
  }

  updateExplosions(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const x = this.explosions[i];
      x.age += dt;
      const t = x.age / x.life;
      x.mesh.scale.setScalar(1 + t * 3.5);
      x.mesh.material.opacity = Math.max(0, 1 - t);
      if (t >= 1) {
        this.scene.remove(x.mesh);
        this.explosions.splice(i, 1);
      }
    }
  }

  updateCamera(dt = 1 / 60) {
    const p = this.player;
    const back = new THREE.Vector3(
      Math.sin(p.yaw) * Math.cos(p.pitch),
      -Math.sin(p.pitch) * 0.35 + 0.35,
      Math.cos(p.yaw) * Math.cos(p.pitch)
    );
    const desired = p.mesh.position.clone().addScaledVector(back, 7.6);
    // 相机只比机身略高：原来 +3.1 会让视线低头 39°，天空完全出画（云和地平线都白做了）
    // 1.9 对应约 17° 俯角，画面上部留出 1/4 天空
    desired.y = p.mesh.position.y + 1.9 - Math.sin(p.pitch) * 3.2;
    // 用指数衰减而不是固定比例：固定 0.12 是"每帧"收敛，120Hz 屏上相机响应
    // 会比 60Hz 快一倍，手感随设备变化。这里按时间收敛，任何刷新率一致。
    const k = 1 - Math.exp(-8.0 * Math.min(dt, 0.1));
    this.camera.position.lerp(desired, k);
    const look = p.mesh.position.clone();
    look.y -= 0.15;
    this.camera.lookAt(look);
    if (this.sky) this.sky.position.copy(this.camera.position);
    if (this.farRange) {
      this.farRange.position.x = this.camera.position.x;
      this.farRange.position.z = this.camera.position.z;
    }
  }
}
