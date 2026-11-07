import { randomUUID } from 'node:crypto';
import { expandedCards } from './professional-expanded.js';
import { writeRelation } from './relations.js';
import { saveProfessional, professionalDomains } from './professional.js';
import { transaction } from './knowledge/store.js';
const groups = [
  ['游戏设计与策划', '游戏机制与体验', '数值与成长', '内容与关卡'],
  ['软件设计与技术架构', '设计原则', '系统组织', '技能与效果系统', '交互与行为模式', '性能模式'],
  ['游戏运行时与算法', '物理与碰撞', '运行时与空间', '游戏 AI 与寻路'],
  ['图形渲染与视觉技术', '渲染基础', '2D / 3D 表现', '渲染优化'],
  ['美术、动画与音频', '视觉设计基础', '资源与动画管线', '声音制作'],
  ['UI 与交互实现', '界面组织', '输入与反馈'],
  ['数据、存档与网络', '数据与持久化', '联机与同步'],
  ['开发工具与工程化', '引擎工作流', '协作与自动化'],
  ['测试、性能与发布', '测试与验证', '性能与适配'],
];
const rapier = 'https://rapier.rs/docs/user_guides/javascript/';
const epic = 'https://dev.epicgames.com/documentation/en-us/unreal-engine/';
// Each row is an original concise synthesis. The source and boundary travel with the card.
export const sampleCards = [
  [
    'controller',
    '角色控制器',
    'Character Controller',
    'concept',
    '物理与碰撞',
    '根据期望位移和场景障碍计算可执行的角色移动。',
    'Rapier 的控制器用射线及形状投射修正路径，结果仍须应用到刚体或碰撞体。常用于行走、斜坡与台阶处理。',
    'Rapier 内置实现只处理平移；手感仍需按具体游戏调校。',
    rapier + 'character_controller/',
    'Rapier JavaScript 0.21 · Controllers',
  ],
  [
    'collider',
    '碰撞体',
    'Collider',
    'concept',
    '物理与碰撞',
    '用于接触和碰撞查询的几何形状。',
    '一个刚体可以挂多个碰撞体，接触力依赖实际碰撞形状。渲染网格和碰撞形状承担不同职责。',
    '复杂形状会增加计算成本，不能仅靠刚体描述碰撞几何。',
    rapier + 'colliders/',
    'Rapier JavaScript 0.21 · Colliders',
  ],
  [
    'body',
    '刚体',
    'Rigid Body',
    'concept',
    '物理与碰撞',
    '描述非形变物体运动学与动力学状态的物理对象。',
    '刚体管理位置、速度和受力，碰撞体补充几何。动态物体与用户控制轨迹的运动学物体需选择不同更新方式。',
    '刚体本身没有碰撞形状；车辆和布娃娃还需要约束。',
    rapier + 'rigid_bodies/',
    'Rapier JavaScript 0.21 · Rigid-bodies',
  ],
  [
    'ray',
    '射线检测',
    'Raycast',
    'method',
    '物理与碰撞',
    '查询半直线与场景碰撞体的相交结果。',
    '射线由起点和方向定义，可限制长度并过滤对象。返回首次命中或更多结果的查询成本不同。',
    '射线没有体积；需要检测实体沿途占用空间时应考虑形状投射。',
    rapier + 'scene_queries/',
    'Rapier JavaScript 0.21 · Scene queries',
  ],
  [
    'rapier',
    'Rapier 物理引擎',
    'Rapier',
    'tool',
    '物理与碰撞',
    '提供二维与三维物理模拟及几何查询的引擎。',
    '其控制器是在刚体、碰撞体和场景查询之上的运动辅助工具。可将输入产生的期望位移与物理查询结果连接起来。',
    '引擎提供通用机制，不能替代游戏特定的移动策略。',
    rapier + 'character_controller/',
    'Rapier JavaScript 0.21 · Controllers',
  ],
  [
    'cohesion',
    '高内聚与低耦合',
    'Cohesion / Coupling',
    'principle',
    '设计原则',
    '让相关职责聚集，并减少不同职责之间必须共同理解的依赖。',
    '按物理、输入、渲染等领域拆分职责，有助于局部修改。分离后的通信方式仍需设计。',
    '这是设计目标，不意味着组件数量越多越好；性能与复杂度需要权衡。',
    'https://gameprogrammingpatterns.com/architecture-performance-and-games.html',
    'Robert Nystrom · Architecture, Performance, and Games',
  ],
  [
    'component',
    '组件模式',
    'Component Pattern',
    'architecture',
    '系统组织',
    '将一个对象跨越多个领域的职责拆成独立组件。',
    '对象聚合不同职责的组件，使物理、输入与显示代码可以分别演进。组件间仍通过明确的数据或接口协作。',
    '一般组件组合不自动等同于数据导向的 ECS。',
    'https://gameprogrammingpatterns.com/component.html',
    'Robert Nystrom · Component',
  ],
  [
    'observer',
    '观察者与事件通知',
    'Observer / Event Notification',
    'architecture',
    '交互与行为模式',
    '让事件源通过订阅接口通知观察者，而不绑定其具体实现。',
    '可用来分离物理事件与成就等独立系统。通知传播需要考虑生命周期及调用关系。',
    '同步观察者通知不等于异步事件队列，过度间接会增加理解成本。',
    'https://gameprogrammingpatterns.com/observer.html',
    'Robert Nystrom · Observer',
  ],
  [
    'ecs',
    '实体组件系统',
    'ECS / Entity Component System',
    'architecture',
    '系统组织',
    '将实体身份、组件数据与系统处理分离的组织方式。',
    'Unity Entities 将实体作为标识，组件承载数据，系统执行行为；与传统面向对象组件的职责安排不同。',
    '这里引用 Entities 1.0.16 的术语，不保证其他 ECS 的接口相同。',
    'https://docs.unity3d.com/Packages/com.unity.entities@1.0/manual/concepts-intro.html',
    'Unity Entities 1.0.16 · ECS concepts',
  ],
  [
    'modifier',
    '属性修饰器',
    'Attribute Modifier',
    'concept',
    '技能与效果系统',
    '对属性数值施加计算规则的机制。',
    '在 GAS 中，Gameplay Effect 的 Modifiers 描述与属性的数值交互；复杂运算可以使用 Execution Calculation。',
    '这是通用机制的概括；叠加顺序与公式必须依据具体系统确认。',
    epic + 'gameplay-effects-for-the-gameplay-ability-system-in-unreal-engine',
    'Epic Unreal Engine 5.8 · Gameplay Effects',
  ],
  [
    'effect',
    'Gameplay Effect',
    'Gameplay Effect',
    'architecture',
    '技能与效果系统',
    'GAS 中用于改变目标属性及效果行为的数据资产。',
    '效果可立即、持续有限时间或无限持续；运行时通常通过 Gameplay Effect Spec 使用效果定义。',
    'Gameplay Effect 是引擎专有实现，不应与通用属性修饰器等同。',
    epic + 'gameplay-effects-for-the-gameplay-ability-system-in-unreal-engine',
    'Epic Unreal Engine 5.8 · Gameplay Effects',
  ],
  [
    'gas',
    'Gameplay Ability System',
    'GAS',
    'tool',
    '技能与效果系统',
    'Unreal Engine 用于组织能力、属性及其交互的框架。',
    'Ability System Component 连接能力、属性集与 Gameplay Effects；能力还可协调动画和表现。',
    '适合需要这些机制的项目，不能据此认定所有游戏都应采用 GAS。',
    epic + 'gameplay-ability-system-for-unreal-engine',
    'Epic Unreal Engine 5.8 · Gameplay Ability System',
  ],
];
const directorySpec = () => {
  const rows = [{ key: 'game', parent: null, name: '游戏研发' }];
  groups.forEach((g, i) => {
    rows.push({ key: 'group-' + i, parent: 'game', name: g[0] });
    g.slice(1).forEach((name, j) =>
      rows.push({ key: `domain-${i}-${j}`, parent: 'group-' + i, name }),
    );
  });
  return rows;
};
export function seedPreview(db, batch='samples') {
  if(!['samples','full'].includes(batch))throw Error('初始化批次无效。');
  const cards=batch==='full'?[...sampleCards,...expandedCards]:sampleCards;
  return {
    version: 1,
    domains: directorySpec().filter(
      (d) => !db.prepare('SELECT 1 FROM professional_domains WHERE seed_key=?').get(d.key),
    ),
    cards: cards
      .filter((c) => !db.prepare('SELECT 1 FROM professional_entries WHERE seed_key=?').get(c[0]))
      .map((c) => ({ key: c[0], title: c[1], source: c[8] })),
    notice: '只新增缺失的种子，不覆盖已有记录或人工修改。首批12张通过后方可扩展。',
  };
}
export function seedSamples(db, input) {
  if (input.confirm !== '创建已审核专业样例') throw Error('请审核差异后确认。');
  const batch=input.batch||'samples';
  if(!['samples','full'].includes(batch))throw Error('初始化批次无效。');
  if(batch==='full'&&sampleCards.some(c=>!db.prepare('SELECT 1 FROM professional_entries WHERE seed_key=?').get(c[0])))throw Error('请先初始化并验证首批12张样例。');
  const cards=batch==='full'?[...sampleCards,...expandedCards]:sampleCards;
  transaction(db, () => {
    for (const [position, d] of directorySpec().entries()) {
      if (db.prepare('SELECT 1 FROM professional_domains WHERE seed_key=?').get(d.key)) continue;
      const parent = d.parent
        ? db.prepare('SELECT id FROM professional_domains WHERE seed_key=?').get(d.parent).id
        : null;
      db.prepare('INSERT INTO professional_domains VALUES(?,?,?,?,?,?,?)').run(
        randomUUID(),
        parent,
        d.name,
        '涵盖' + d.name + '相关概念与方法。',
        '不代表该领域已有完整内容覆盖。',
        position,
        d.key,
      );
    }
    const created=new Set();
    for (const c of cards) {
      if (db.prepare('SELECT 1 FROM professional_entries WHERE seed_key=?').get(c[0])) continue;
      const domainKey=directorySpec().find(d=>d.name===c[4]).key;
      const domain = professionalDomains(db).find((d) => d.seed_key === domainKey);
      const e = saveProfessional(
        db,
        {
          title: c[1],
          description: c[5],
          content: '<h2>作用与原理</h2><p>' + c[6] + '</p>',
          concept_kind: c[3],
          status:'review',
          aliases: [c[2]],
          scope_note: c[7],
          professional_domains: [domain.id],
          primary_domain: domain.id,
          newSource: {
            kind: 'website',
            title: c[9],
            url: c[8],
            excerpt: c[5] + ' ' + c[6],
            date_note: (c[10]==='pending'||['cohesion','component','observer'].includes(c[0])?'待核验：原文未完整取得，不能视作核验通过。':'2026-11-07 来源页面已核对，正文为原创归纳，人工待审核。')+' '+c[9],
          },
        },
        undefined,
        { outer: true },
      );
      db.prepare('UPDATE professional_entries SET seed_key=? WHERE entry_id=?').run(c[0], e.id);
      created.add(c[0]);
    }
    for(const [from,to] of [['controller','collider'],['controller','body'],['controller','ray'],['rapier','controller'],['cohesion','component'],['cohesion','observer'],['component','ecs'],['modifier','effect'],['effect','gas'],['mda','core-loop'],['core-loop','feedback'],['feedback','growth'],['srp','cohesion'],['composition','component'],['data-driven','scriptable-object'],['fsm','controller'],['collision','collider'],['game-loop','body'],['render-pipeline','shader'],['particles','render-pipeline'],['visual-composition','contrast'],['contrast','hierarchy'],['asset-pipeline','prefab'],['skeletal','asset-pipeline'],['hud','hierarchy'],['input-actions','controller'],['serialization','save-migration'],['save-migration','stable-id'],['prefab','scriptable-object'],['mcp','stable-id'],['testing','save-migration'],['profiler','particles']]){
      if(!created.has(from)&&!created.has(to))continue;
      if(!db.prepare('SELECT 1 FROM professional_entries WHERE seed_key=?').get(from)||!db.prepare('SELECT 1 FROM professional_entries WHERE seed_key=?').get(to))continue;
      const a=db.prepare('SELECT entry_id FROM professional_entries WHERE seed_key=?').get(from).entry_id;
      const b=db.prepare('SELECT entry_id FROM professional_entries WHERE seed_key=?').get(to).entry_id;
      writeRelation(db,{from_id:a,to_id:b,type:'related',note:'样例知识链关联候选，请结合来源人工审核。',evidence:[],uncertainty:'相关概念不等同，候选尚未人工确认。'},{origin:'import',state:'candidate'});
    }
  });
  return seedPreview(db,batch);
}
