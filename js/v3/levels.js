/**
 * 关卡表：只放数据，不放玩法逻辑。
 *
 * 一关能描述的东西有：
 *   start   —— 玩家出生点与初始航向（yaw=0 朝 -Z，即朝向岛屿；π 朝 +Z，朝向开阔海面）
 *   base    —— 需要守护的己方编队（关卡 2 的守航母）
 *   strike  —— 来袭敌机的波次、血量与投弹参数（关卡 2）
 *   escort  —— 逼近的反舰目标（关卡 2 阶段 B）
 *   briefing / checkpoint / victory / defeat —— 文案
 *
 * 关卡 1 的波次与检查点数字沿用原型里的实测值（6 架进入检查点、12 架通关），
 * 这些数字是手感调出来的，不做"统一化"重排。
 */

export const LEVELS = [
  {
    id: 1,
    title: '云上的眼睛',
    subtitle: '侦察护航',
    playable: true,
    start: { x: 0, y: 46, z: 40, yaw: 0 },
    briefing: [
      '1942 年 6 月，太平洋上的中途岛将成为战局转折点。',
      '本作以现代空战形式进行作战推演——先发现敌人，才能赢得先机。',
      '特工学员，驾驶战机护航侦察：击落来袭敌机，守住「云上的眼睛」。',
    ],
    checkpointLine: '检查点达成：第一波敌机清除。编队状态已保存（登录后可持久化）。',
    victory: {
      title: '云上的眼睛',
      body: '历史收束：侦察与预警，让中途岛在暴风雨来临前看见了敌人。',
    },
    defeat: {
      player: '任务中断。从检查点重试，继续护航侦察。',
      base: '任务中断。从检查点重试，继续护航侦察。',
    },
  },
  {
    id: 2,
    title: '岛上的风暴',
    subtitle: '编队防空 · 反舰突击',
    playable: true,
    // 背对岛屿面向外海：敌机从开阔海面扑向身后的航母，起飞就要迎头拦截
    start: { x: 0, y: 46, z: -180, yaw: Math.PI },
    base: { x: 0, y: -18, z: -250, hp: 520, radius: 42 },
    strike: {
      waveSize: 2,
      total: 8,        // 阶段 A 需要拦截的总架数
      hp: 26,
      // 比巡航速度略慢：第一次对头穿越后，玩家松油门也能追上，
      // 否则拦截会变成"永远追不上的尾巴"
      speed: 26,
      orbit: 62,       // 抵近后绕航母盘旋的半径
      fireRange: 95,
      fireCd: 2.6,
      damage: 7,
    },
    escort: {
      // 阶段 B：两艘驱逐舰从外海压上来。血量按"一发地狱火刚好击沉"设定，
      // 否则 22 秒冷却会让这一段变成干等。
      count: 2,
      hp: 88,
      speed: 7,
      spawn: [
        { x: -260, z: 260 },
        { x: 260, z: 200 },
      ],
    },
    briefing: [
      '1942 年 6 月 4 日清晨，日军第一波攻击机群越过滩头，直扑中途岛。',
      '历史上，岛上的雷达在 30 英里外抓住了它们——这一次，负责拦截的是你。',
      '任务：守住航母编队。先打掉来袭的敌机，再击沉逼近的驱逐舰。',
    ],
    checkpointLine: '检查点达成：第一波来袭敌机全部击落，编队装甲已恢复。转入反舰阶段。',
    victory: {
      title: '岛上的风暴',
      body: '历史收束：这一天的中途岛没有被炸哑，跑道仍在，反击正是从这里起飞。',
    },
    defeat: {
      player: '座机被击落。编队还在等你归队——从检查点重新起飞。',
      base: '航母编队失去动力，滩头失去了掩护。这一仗必须重打。',
    },
  },
  {
    id: 3,
    title: '勇敢的诱饵',
    subtitle: '牵制与牺牲',
    playable: true,
    start: { x: 0, y: 46, z: 40, yaw: 0 },
    // 纯存活：倒计时结束即胜（击落数只作彩蛋），撑过 cpAt 秒进检查点
    survive: {
      duration: 90,   // 总时长（秒）
      cpAt: 45,       // 检查点时间
      capA: 4,        // 阶段 A 同屏敌机上限（28 血）
      capB: 4,        // 阶段 B 同屏敌机上限（36 血）
      refillA: 12,    // 阶段 A 补满到上限的间隔（秒）
      refillB: 9,     // 阶段 B 补满到上限的间隔（秒）
    },
    briefing: [
      '1942 年 6 月 4 日，鱼雷机群贴着海面扑向日军舰队。',
      '它们一架接一架坠落，却把敌人的战斗机全都拽了下来。',
      '任务：牵制来袭敌机，撑过最危险的一刻，直到友军俯冲轰炸机赶到。',
    ],
    checkpointLine: '检查点达成：诱饵牵制已过半，友军机群正在接近。',
    victory: {
      title: '勇敢的诱饵',
      body: '历史收束：那些坠入海中的鱼雷机，为「决定性的五分钟」买下了入场券。',
    },
    defeat: {
      player: '诱饵被击落，牵制失败了。从检查点重新起飞。',
      base: '诱饵被击落，牵制失败了。从检查点重新起飞。',
    },
  },
  {
    id: 4,
    title: '决定性的五分钟',
    subtitle: '俯冲命中航母',
    playable: true,
    // 面向岛屿：敌军舰队停在海面上，玩家从外海方向进入
    start: { x: 0, y: 46, z: 120, yaw: 0 },
    fleet: {
      carriers: [
        { hp: 500, spawn: { interval: 9, cap: 3, fromPhase: 'B' } },
      ],
      destroyers: [{ hp: 160 }],
      // 阶段 A：击落 6 架护航机即突破护航
      phaseA: { kills: 6, hp: 28, initial: 3, refill: 12 },
      // 阶段 B：击沉航母 + 驱逐舰；航母持续产护航机骚扰
      escortCap: 6,
    },
    briefing: [
      '上午 10 点，日军航母甲板上堆满了换挂弹药的飞机。',
      '这就是历史上那个「决定性的五分钟」——五分钟后，三艘航母都将燃起大火。',
      '任务：突破护航，俯冲命中敌方主力航母。',
    ],
    checkpointLine: '检查点达成：护航已撕开缺口，进入俯冲打击。',
    victory: {
      title: '决定性的五分钟',
      body: '历史收束：五分钟的决断，让太平洋战局在一日之间易手。',
    },
    defeat: {
      player: '座机被击落。突破护航再来一次。',
      base: '座机被击落。突破护航再来一次。',
    },
  },
  {
    id: 5,
    title: '最后的反击',
    subtitle: '收束',
    playable: true,
    start: { x: 0, y: 46, z: 120, yaw: 0 },
    fleet: {
      carriers: [
        { hp: 400, spawn: { interval: 12, cap: 2, fromPhase: 'A' } },
        { hp: 400, spawn: { interval: 12, cap: 2, fromPhase: 'A' } },
      ],
      destroyers: [{ hp: 160 }, { hp: 160 }],
      // 阶段 A：击沉第一艘航母即进检查点
      phaseA: { sinks: 1, hp: 36, initial: 2, refill: 14 },
      escortCap: 6,
    },
    briefing: [
      '夕阳西下，日军最后一艘航母仍在海面上。',
      '它是这场海战最后的抵抗——击沉它，中途岛就彻底安静下来。',
      '任务：清剿残余航母群，一个都不能留。',
    ],
    checkpointLine: '检查点达成：首舰已沉，乘胜追击清剿残敌。',
    victory: {
      title: '最后的反击',
      body: '历史收束：太平洋的天空重新安静下来，中途岛守住了。五关作战推演全部完成。',
    },
    defeat: {
      player: '座机被击落。残敌仍在，从检查点重新出击。',
      base: '座机被击落。残敌仍在，从检查点重新出击。',
    },
  },
];

export function getLevel(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[0];
}

export function nextPlayable(level) {
  return LEVELS.find((l) => l.id === level.id + 1 && l.playable) || null;
}
