/* ==========================================================================
   五个关卡的数据与脚本（成年向 · 历史严肃）
   结构统一：简报式故事卡 ×3 → 任务简报 → 战斗 → 结算 → 战史档案
   ========================================================================== */
(function (root) {
  'use strict';
  var MG = root.MG;

  var ENV = {
    dawn:  { skyTop: '#5E7790', skyLow: '#E8B87E', seaTop: '#3A6C82', seaMid: '#2E5E75', seaBot: '#152F44', sunX: 0.68 },
    day:   { skyTop: '#C6D8E8', skyLow: '#E4EEF4', seaTop: '#3A7096', seaMid: '#2A6389', seaBot: '#1E4A6B', sunX: 0.72 },
    over:  { skyTop: '#9AA8B4', skyLow: '#D2DDE3', seaTop: '#3A6C82', seaMid: '#2E5E75', seaBot: '#17394B', sun: false },
    noon:  { skyTop: '#A8C8DE', skyLow: '#EAF4FA', seaTop: '#3A7096', seaMid: '#2A6389', seaBot: '#1E4A6B', sunX: 0.5, sunCol: 'rgba(255,255,246,.98)' },
    dusk:  { skyTop: '#3A5068', skyLow: '#E8A050', seaTop: '#2A4F6B', seaMid: '#23445C', seaBot: '#101F2E', sunX: 0.76, sunCol: 'rgba(255,190,120,.92)' }
  };

  MG.LEVELS = [

  /* ======================= 关卡 1 ======================= */
  {
    id: 1, no: '01', title: '云上的眼睛', date: '1942.6.4  04:30',
    plane: 'pby', env: ENV.dawn, scene: 'scout',
    story: [
      '1942 年 6 月，太平洋中部。美军已破译日军的作战密码。',
      '情报指向一个代号「AF」的目标——中途岛。',
      '你驾驶卡特琳娜侦察机升空，去确认这支舰队的方位。'
    ],
    brief: {
      meta: '中途岛西北 · 远程侦察',
      task: '飞抵 <b>3 个侦察点</b>，确认日军舰队位置。巡逻的敌机不会主动追击。'
    },
    objective: { type: 'scout', points: 3 },
    radio: {
      start: '侦察机升空，保持高度。',
      p1: '记录第一处观察点。',
      p2: '海面有情况，继续侦察。',
      p3: '确认：这是日军主力舰队。',
      half: '注意，前方有敌机巡逻。',
      end: '返航，把情报带回去。'
    },
    waves: [
      { at: 3,  type: 'balloon', n: 5, pattern: 'drift', speed: 14 },
      { at: 12, type: 'zero', n: 2, pattern: 'drift', speed: 52, fire: 0 },
      { at: 42, type: 'balloon', n: 3, pattern: 'drift', speed: 14 },
      { at: 52, type: 'zero', n: 2, pattern: 'weave', fire: 3.4, stationY: 0.34, speedScale: 0.8 },
      { at: 86, type: 'destroyer', n: 1, vx: 26 },
      { at: 104, type: 'zero', n: 3, pattern: 'weave', fire: 3.0, stationY: 0.30 }
    ],
    archive: {
      fact: '美军提前破译了日军密码，确认「AF」即中途岛。这场海战中，情报优势让美军得以提前设伏，以逸待劳。'
    }
  },

  /* ======================= 关卡 2 ======================= */
  {
    id: 2, no: '02', title: '小岛保卫战', date: '1942.6.4  06:00',
    plane: 'wildcat', env: ENV.day, scene: 'defend', island: 0.5,
    story: [
      '1942 年 6 月 4 日清晨，日军第一波 108 架飞机空袭中途岛。',
      '岛上的美军航空兵几乎全部起飞迎战。',
      '你驾驶野猫战斗机，拦截来袭的敌机。'
    ],
    brief: {
      meta: '中途岛环礁上空 · 防空拦截',
      task: '拦截所有空袭中途岛的敌机。环礁被命中 <b>5 次</b>，任务失败。'
    },
    objective: { type: 'defend', targetName: '中途岛环礁', hp: 5 },
    radio: {
      start: '敌机编队来袭！',
      w1: '第一波！准备接敌！',
      w2: '第二波，注意掩护！',
      hit: '环礁遭袭，顶住！',
      w3: '最后一波，全部拦下！',
      end: '环礁守住了。'
    },
    waves: [
      { at: 6,  type: 'val', n: 3, pattern: 'dive', speedScale: 0.8 },
      { at: 62, type: 'val', n: 4, pattern: 'dive', speedScale: 0.9 },
      { at: 70, type: 'zero', n: 2, pattern: 'weave', fire: 2.4, stationY: 0.34 },
      { at: 120, type: 'val', n: 5, pattern: 'dive', speedScale: 1.0 },
      { at: 128, type: 'zero', n: 2, pattern: 'weave', fire: 2.0, stationY: 0.30 }
    ],
    archive: {
      fact: '首轮空袭中，中途岛的美军航空兵损失惨重，但机场仍可使用。他们以巨大代价拖住了日军，为随后的反击争取了时间。'
    }
  },

  /* ======================= 关卡 3 ======================= */
  {
    id: 3, no: '03', title: '引开敌人', date: '1942.6.4  08:10',
    plane: 'avenger', env: ENV.over, scene: 'escort',
    story: [
      '美军鱼雷机群低空突入，直扑日军航母。',
      '但他们被零式战斗机和高射炮死死咬住。',
      '你的任务：把敌机引开，掩护鱼雷机编队脱离。'
    ],
    brief: {
      meta: '日军机动部队外围 · 低空突击',
      task: '靠近敌机，把他们从鱼雷机编队旁<b>引走</b>。掩护 <b>3 架</b>友机安全脱离。'
    },
    objective: { type: 'escort', count: 3 },
    radio: {
      start: '保持低空，掩护编队。',
      aggro: '敌机转向我们了，引开他们！',
      saved: '一架安全脱离！',
      lone: '还剩一架，继续掩护。',
      end: '编队脱离，任务完成。'
    },
    waves: [
      { at: 5,  type: 'zero', n: 3, pattern: 'chase', fire: 2.6, speedScale: 0.85 },
      { at: 30, type: 'zero', n: 3, pattern: 'chase', fire: 2.4 },
      { at: 55, type: 'destroyer', n: 1, vx: 20 },
      { at: 62, type: 'zero', n: 3, pattern: 'weave', fire: 2.2, stationY: 0.36 },
      { at: 92, type: 'destroyer', n: 1, vx: -22, side: 'right' },
      { at: 100, type: 'zero', n: 4, pattern: 'chase', fire: 2.2 },
      { at: 138, type: 'zero', n: 3, pattern: 'weave', fire: 2.0, stationY: 0.32 }
    ],
    archive: {
      fact: '这场战斗中，美军鱼雷机几乎全军覆没，几乎未取得战果。但他们把日军战斗机拖在了低空，为随后的俯冲轰炸机创造了决定性的机会。'
    }
  },

  /* ======================= 关卡 4 ======================= */
  {
    id: 4, no: '04', title: '五分钟', date: '1942.6.4  10:20',
    plane: 'sbd', env: ENV.noon, scene: 'cloud',
    story: [
      '日军航母甲板上，飞机与弹药堆叠——他们正在换装。',
      '这是整场战役中，敌方最脆弱的一刻。',
      '你驾驶无畏式俯冲轰炸机，从云层中发起俯冲。'
    ],
    brief: {
      meta: '日军机动部队上空 · 俯冲轰炸',
      task: '先飞至<b>画面上方</b>云层，再按住<b>投弹</b>俯冲。击沉 <b>3 艘</b>航空母舰。'
    },
    objective: { type: 'bomb', ships: 3, shipType: 'carrier' },
    radio: {
      start: '爬升，进入云层待命。',
      cloud: '保持隐蔽，等待时机。',
      dive: '俯冲！瞄准飞行甲板！',
      perfect: '正中目标！',
      good: '命中！',
      miss: '偏了，重新拉起。',
      end: '三艘航母全部失去战斗力。'
    },
    waves: [
      { at: 2,  type: 'carrier', n: 3, vx: 12 },
      { at: 14, type: 'zero', n: 3, pattern: 'weave', fire: 2.6, stationY: 0.24 },
      { at: 70, type: 'zero', n: 3, pattern: 'weave', fire: 2.2, stationY: 0.30 },
      { at: 130, type: 'zero', n: 4, pattern: 'chase', fire: 2.4 },
      { at: 190, type: 'zero', n: 3, pattern: 'weave', fire: 2.0, stationY: 0.26 }
    ],
    archive: {
      fact: '从第一枚炸弹命中，到赤城、加贺、苍龙三艘航母失去战斗力，仅用了大约五分钟。这是中途岛海战的决定性时刻。'
    }
  },

  /* ======================= 关卡 5 ======================= */
  {
    id: 5, no: '05', title: '最后的反击', date: '1942.6.4  17:00',
    plane: 'sbd', env: ENV.dusk, scene: 'carrier',
    story: [
      '日军仅存的航母飞龙号发起了反击。',
      '它的机群直扑美军的约克城号。',
      '先守住，再终结这场战役。'
    ],
    brief: {
      meta: '暮色中的追击 · 防守转进攻',
      task: '第一阶段：拦截飞向约克城号的敌机。第二阶段：击沉<b>飞龙号</b>。'
    },
    objective: { type: 'mixed', targetName: '约克城号', hp: 3, shipType: 'carrier' },
    radio: {
      start: '敌机来袭，准备拦截！',
      hold: '顶住，这是最后一批！',
      switch: '轮到我们进攻了。',
      dive: '俯冲！目标飞龙号！',
      end: '海面恢复了平静。'
    },
    waves: [
      { at: 4,  type: 'kate', n: 3, pattern: 'torp', fire: 3.0, dropX: 0.2 },
      { at: 26, type: 'zero', n: 3, pattern: 'weave', fire: 2.2, stationY: 0.28 },
      { at: 48, type: 'kate', n: 3, pattern: 'torp', fire: 2.8, dropX: 0.3 },
      { at: 70, type: 'zero', n: 4, pattern: 'chase', fire: 2.2 },
      { at: 92, type: 'carrier', n: 1, vx: 10, phase: 'B' },
      { at: 96, type: 'destroyer', n: 1, vx: 18, phase: 'B' },
      { at: 120, type: 'zero', n: 3, pattern: 'weave', fire: 2.2, stationY: 0.26, phase: 'B' },
      { at: 168, type: 'cruiser', n: 1, vx: -14, phase: 'B' },
      { at: 196, type: 'zero', n: 3, pattern: 'chase', fire: 2.0, phase: 'B' }
    ],
    archive: {
      fact: '飞龙号的反击重创了约克城号，但飞龙号随即被击沉。此役日本损失四艘大型航母。中途岛海战，被后世称为太平洋战争的转折点。'
    }
  }
  ];

  /* 关卡结束语 */
  MG.LEVEL_END = {
    1: '你确认了日军舰队的方位。这份情报，决定了整场战役的走向。',
    2: '环礁守住了。第一次交战，你挡住了敌人的空袭。',
    3: '你们没有击沉一艘船，但你们让鱼雷机编队安全脱离。',
    4: '五分钟，三艘航母。这一战改变了整个太平洋的战局。',
    5: '你飞完了整场战役。海面恢复了平静。'
  };

})(window);
