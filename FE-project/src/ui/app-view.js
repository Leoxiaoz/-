/**
 * App View（UI 层）。
 * 层级归属：UI Layer。只做「呈现 + 事件转发」，**不含任何模拟逻辑**。
 *
 * 约束（对应 mobile-ui-ux Skill）：
 * - 不直接访问 Core / Data / Save，只通过 GameController；
 * - 使用 textContent 渲染，避免注入；
 * - 边界态（未启动 / 错误）有明确表现；
 * - 触摸友好（按钮尺寸由 CSS 控制）。
 */

import { reportError } from '../shared/errors.js';

export class AppView {
  /**
   * @param {{root: HTMLElement, controller: object, logger?: object}} deps
   */
  constructor(deps) {
    this.root = deps.root;
    this.controller = deps.controller;
    this.logger = deps.logger ?? null;
    this.status = { message: '正在启动…', isError: false };
    this.#unsubscribe = null;
  }

  #unsubscribe;

  /** 生涯是否已开始（false 时显示「新建生涯 · 选择球队」界面）。 */
  #careerStarted = false;

  /** 绑定事件并订阅状态变化。 */
  mount() {
    const actions = document.getElementById('app-actions');
    actions?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.#handleAction(btn.dataset.action);
    });
    // 视图内交互（玩家阵容 / 战术）：事件委托，UI 只转发，规则在 Controller。
    this.root?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) this.#handleViewAction(btn);
    });
    this.root?.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-action]');
      if (sel) this.#handleViewChange(sel);
    });
    this.#unsubscribe = this.controller.subscribe((snapshot) => this.render(snapshot));
    this.render(this.controller.getSnapshot());
  }

  unmount() {
    this.#unsubscribe?.();
  }

  async #handleAction(action) {
    try {
      if (action === 'new-career') {
        this.controller.newCareer();
        this.#careerStarted = false;
        this.setStatus('已新建生涯，请选择管理球队');
      } else if (action === 'advance-next-match') {
        const summary = this.controller.advanceToNextMatch();
        this.setStatus(describeAdvance(summary, '下一场'));
      } else if (action === 'advance-next-round') {
        const summary = this.controller.advanceToNextRound();
        this.setStatus(describeAdvance(summary, '本轮'));
      } else if (action === 'save') {
        const slot = await this.controller.save('slot1');
        this.setStatus(`已保存到存档 ${slot}`);
      } else if (action === 'load') {
        await this.controller.load('slot1');
        this.#careerStarted = true;
        this.setStatus('已读取存档 slot1');
      }
    } catch (err) {
      this.setStatus(reportError(err, this.logger ?? { error() {} }), true);
    }
  }

  /** 视图内按钮：转发到 Controller，并把结果问题反馈到状态栏（不吞错误）。 */
  #handleViewAction(btn) {
    try {
      const action = btn.dataset.action;
      const clubId = btn.dataset.club ?? this.controller.getManagedClubId();
      let result = { success: true, issues: [] };
      if (action === 'start-career') {
        result = this.controller.setManagedClub(clubId || null);
        if (result?.success) {
          this.#careerStarted = true;
          this.setStatus(clubId ? '已开始生涯' : '已开始生涯（全自动管理）');
        } else {
          this.setStatus((result?.issues ?? []).join('；') || '操作未生效', true);
        }
        return;
      }
      if (action === 'auto-fill') {
        result = this.controller.autoFillManagedLineup();
      } else if (action === 'clear-lineup') {
        result = this.controller.setLineup(clubId, { starters: [], bench: [] });
      } else if (action === 'assign-player') {
        result = this.controller.assignLineupPlayer(clubId, btn.dataset.player, btn.dataset.zone);
      } else {
        return;
      }
      const issues = result?.issues ?? [];
      if (!result?.success) {
        this.setStatus(issues.join('；') || '操作未生效', true);
      } else {
        this.setStatus(issues.length > 0 ? issues.join('；') : '已更新');
      }
    } catch (err) {
      this.setStatus(reportError(err, this.logger ?? { error() {} }), true);
    }
  }

  /** 视图内下拉：管理球队 / 阵型 / 战术。 */
  #handleViewChange(sel) {
    try {
      const action = sel.dataset.action;
      if (action === 'select-club') {
        this.controller.setManagedClub(sel.value || null);
        this.setStatus(sel.value ? '已选择管理球队' : '已切换为自动管理');
      } else if (action === 'set-formation') {
        this.controller.setFormation(sel.dataset.club, sel.value);
        this.setStatus('已更新阵型');
      } else if (action === 'set-mentality') {
        this.controller.setMentality(sel.dataset.club, sel.value);
        this.setStatus('已更新战术');
      }
    } catch (err) {
      this.setStatus(reportError(err, this.logger ?? { error() {} }), true);
    }
  }

  /** 更新状态提示并重绘。公开方法，供组合根在启动完成后调用。 */
  setStatus(message, isError = false) {
    this.status = { message, isError };
    this.render(this.controller.getSnapshot());
  }

  /** 渲染当前快照。纯呈现，不做任何推导。 */
  render(snapshot) {
    if (!this.root) return;
    this.root.textContent = '';
    this.root.appendChild(this.#statusNode());

    if (!snapshot) {
      this.root.appendChild(el('p', { class: 'muted' }, '尚未建立世界。'));
      return;
    }

    // 生涯开场（Batch A）：未开始生涯时只显示球队选择界面。
    if (!this.#careerStarted) {
      this.root.appendChild(renderCareerStart(snapshot));
      return;
    }

    const card = el('section', { class: 'card' });
    card.appendChild(el('h2', { class: 'card__title' }, '当前游戏状态'));

    const dl = el('dl', { class: 'kv' });
    appendKV(dl, '世界', `${snapshot.worldName} (${snapshot.worldId})`);
    appendKV(dl, '日期', snapshot.currentDate);
    appendKV(dl, '赛季', String(snapshot.season));
    appendKV(dl, '球队数', String(snapshot.teamsCount));
    appendKV(dl, '球员数', String(snapshot.playersCount));
    if (snapshot.freeAgentsCount != null) appendKV(dl, '自由球员', String(snapshot.freeAgentsCount));
    appendKV(dl, '事件数', String(snapshot.eventsCount));
    card.appendChild(dl);
    this.root.appendChild(card);

    // 我的下一场比赛（Batch A）：来自数据库赛程，便于玩家理解推进目标。
    if (snapshot.nextFixture) {
      this.root.appendChild(renderNextFixture(snapshot.nextFixture));
    }

    // 玩家阵容 / 战术（第 20 步：唯一让玩家参与球队管理的入口）。
    this.root.appendChild(renderManagedClub(snapshot));

    const leagueCard = el('section', { class: 'card' });
    leagueCard.appendChild(el('h2', { class: 'card__title' }, '联赛'));
    const ul = el('ul', { class: 'list' });
    for (const league of snapshot.leagues) {
      ul.appendChild(el('li', {}, `${league.name} — ${league.teamsCount} 支球队`));
    }
    leagueCard.appendChild(ul);
    this.root.appendChild(leagueCard);

    for (const league of snapshot.leagues) {
      this.root.appendChild(renderLeague(league, snapshot.managedClubId));
    }
  }

  #statusNode() {
    return el(
      'p',
      { class: this.status.isError ? 'error' : 'muted' },
      this.status.message,
    );
  }
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

/** 构建一个 <select>；options = [{value,label}]，current 为当前选中值。 */
function select(attrs, options, current) {
  const node = el('select', { ...attrs, class: 'select' });
  for (const opt of options) {
    const o = el('option', { value: opt.value }, opt.label);
    if (opt.value === current) o.setAttribute('selected', '');
    node.appendChild(o);
  }
  node.value = current ?? '';
  return node;
}

/** 「我的球队」卡片：选择管理球队 → 阵型/战术 → 首发/替补（第 20 步）。纯呈现 + 事件转发。 */
function renderManagedClub(snapshot) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('h2', { class: 'card__title' }, '我的球队'));

  // 未选择管理球队：仅提供选择入口（默认 null = 全部自动管理）。
  if (!snapshot.managedClub) {
    card.appendChild(el('p', { class: 'muted' }, '尚未选择管理球队：当前所有球队均由 AI 自动排阵。选择一支球队后即可自定义阵型、战术与首发。'));
    const clubOptions = [{ value: '', label: '不管理（全部自动）' }]
      .concat(snapshot.clubs.map((c) => ({ value: c.id, label: c.name })));
    card.appendChild(select({ 'data-action': 'select-club' }, clubOptions, ''));
    return card;
  }

  const mc = snapshot.managedClub;
  const clubOptions = [{ value: '', label: '不管理（全部自动）' }]
    .concat(snapshot.clubs.map((c) => ({ value: c.id, label: c.name })));
  card.appendChild(select({ 'data-action': 'select-club' }, clubOptions, mc.id));

  // 阵型 / 战术
  const rows = el('div', { class: 'field-rows' });
  rows.appendChild(fieldRow('阵型', select(
    { 'data-action': 'set-formation', 'data-club': mc.id },
    snapshot.formations.map((f) => ({ value: f, label: f })),
    mc.formation,
  )));
  rows.appendChild(fieldRow('战术', select(
    { 'data-action': 'set-mentality', 'data-club': mc.id },
    snapshot.mentalities.map((m) => ({ value: m.value, label: m.label })),
    mc.mentality,
  )));
  card.appendChild(rows);

  // 操作
  const bar = el('div', { class: 'row-actions' });
  bar.appendChild(el('button', { class: 'btn btn--small', 'data-action': 'auto-fill' }, '自动填充最佳阵容'));
  bar.appendChild(el('button', { class: 'btn btn--small', 'data-action': 'clear-lineup', 'data-club': mc.id }, '清空'));
  card.appendChild(bar);

  if (mc.issues.length > 0) {
    card.appendChild(el('p', { class: 'error' }, mc.issues.join('；')));
  }

  // 首发
  card.appendChild(el('h3', { class: 'card__subtitle' }, `首发（${mc.starters.length}/${mc.limits.starters}）`));
  card.appendChild(squadList(mc.starters, mc, 'starters'));

  // 替补席（本步骤不参与换人）
  card.appendChild(el('h3', { class: 'card__subtitle' }, `替补席（${mc.bench.length}/${mc.limits.bench}）·本步骤暂不参与换人`));
  card.appendChild(squadList(mc.bench, mc, 'bench'));

  // 其余球员
  const others = mc.squad.filter((p) => p.zone === 'none');
  card.appendChild(el('h3', { class: 'card__subtitle' }, `其余球员（${others.length}）`));
  card.appendChild(squadList(others, mc, 'none'));

  return card;
}

function fieldRow(label, control) {
  const row = el('div', { class: 'field-row' });
  row.appendChild(el('span', { class: 'field-row__label' }, label));
  row.appendChild(control);
  return row;
}

/** 球员列表：每名球员提供「首发 / 替补 / 移除」操作（zone='none' 时隐藏"移除"）。 */
function squadList(players, mc, zone) {
  if (players.length === 0) return el('p', { class: 'muted' }, '无');
  const ul = el('ul', { class: 'list lineup' });
  for (const p of players) {
    const li = el('li', { class: 'lineup__item' });

    const row = el('div', { class: 'lineup__row' });
    row.appendChild(el('span', { class: 'lineup__name' }, `${p.name}（${p.position}${p.injured ? ' · 伤' : ''}）`));
    const acts = el('span', { class: 'lineup__actions' });
    if (zone !== 'starters') {
      acts.appendChild(el('button', { class: 'btn btn--mini', 'data-action': 'assign-player', 'data-club': mc.id, 'data-player': p.playerId, 'data-zone': 'starters' }, '首发'));
    }
    if (zone !== 'bench') {
      acts.appendChild(el('button', { class: 'btn btn--mini', 'data-action': 'assign-player', 'data-club': mc.id, 'data-player': p.playerId, 'data-zone': 'bench' }, '替补'));
    }
    if (zone !== 'none') {
      acts.appendChild(el('button', { class: 'btn btn--mini', 'data-action': 'assign-player', 'data-club': mc.id, 'data-player': p.playerId, 'data-zone': 'none' }, '移除'));
    }
    row.appendChild(acts);
    li.appendChild(row);

    // 紧凑统计行（Step 21-B）：赛季汇总；可换行、无横向溢出。
    li.appendChild(statsLine(p.stats));
    ul.appendChild(li);
  }
  return ul;
}

/**
 * 球员赛季统计行（纯呈现）。数据来自 snapshot（controller 已派生 averageRating，UI 不自行计算）。
 * 无出场（averageRating == null）时评分显示 "—"。
 */
function statsLine(stats) {
  const wrap = el('div', { class: 'lineup__stats' });
  const s = stats?.season;
  if (!s) return wrap;
  const rating = s.averageRating == null ? '—' : s.averageRating.toFixed(2);
  const items = [
    `出场 ${s.appearances}`,
    `进球 ${s.goals}`,
    `助攻 ${s.assists}`,
    `射门 ${s.shots}`,
    `射正 ${s.shotsOnTarget}`,
    `评分 ${rating}`,
  ];
  for (const text of items) wrap.appendChild(el('span', { class: 'lineup__stat' }, text));
  wrap.appendChild(el('span', { class: 'lineup__stat lineup__stat--sub' }, `黄 ${s.yellow} · 红 ${s.red}`));
  return wrap;
}

function appendKV(dl, key, value) {
  dl.appendChild(el('dt', {}, key));
  dl.appendChild(el('dd', {}, value));
}

const STATUS_TEXT = {
  scheduled: '未开始',
  in_progress: '进行中',
  finished: '已结束',
  empty: '参赛队不足',
};

/** 渲染单个联赛卡片：概览 + 积分榜 + 最近赛果 + 赛程。纯呈现。 */
function renderLeague(league, managedClubId) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('h2', { class: 'card__title' }, league.name));
  card.appendChild(
    el(
      'p',
      { class: 'muted' },
      `第 ${league.competitionSeason} 赛季 · ${league.teamsCount} 队 · ${league.totalRounds} 轮 · ${STATUS_TEXT[league.status] ?? league.status}`,
    ),
  );

  if (league.table.length > 0) {
    card.appendChild(buildTable(league.table));
  }

  if (league.lastSeason) {
    card.appendChild(
      el('h3', { class: 'card__subtitle' }, `上赛季（第 ${league.lastSeason.season} 赛季）最终排名 · 冠军 ${league.lastSeason.champion ?? '—'}`),
    );
    card.appendChild(buildTable(league.lastSeason.table));
  }

  if (league.recentResults.length > 0) {
    card.appendChild(el('h3', { class: 'card__subtitle' }, '最近赛果'));
    const ul = el('ul', { class: 'list' });
    for (const r of league.recentResults) {
      ul.appendChild(
        el('li', {}, `第 ${r.round} 轮 · ${r.homeName} ${r.homeGoals}-${r.awayGoals} ${r.awayName}`),
      );
    }
    card.appendChild(ul);
  }

  card.appendChild(renderSchedule(league, managedClubId));
  return card;
}

/** 赛程（Batch A）：按轮次分组展示 轮次 / 日期 / 主客队 / 状态 / 赛果；高亮我的球队。 */
function renderSchedule(league, managedClubId) {
  const wrap = el('div', {});
  if (!league.fixtures || league.fixtures.length === 0) {
    wrap.appendChild(el('h3', { class: 'card__subtitle' }, '赛程'));
    wrap.appendChild(el('p', { class: 'muted' }, '暂无赛程。'));
    return wrap;
  }
  wrap.appendChild(el('h3', { class: 'card__subtitle' }, '赛程'));

  const byRound = new Map();
  for (const f of league.fixtures) {
    if (!byRound.has(f.round)) byRound.set(f.round, []);
    byRound.get(f.round).push(f);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  for (const round of rounds) {
    const fixtures = byRound.get(round);
    wrap.appendChild(el('h4', { class: 'schedule__round' }, `第 ${round} 轮 · ${fixtures[0].date}`));
    const ul = el('ul', { class: 'list schedule' });
    for (const f of fixtures) {
      const mine = managedClubId && (f.homeId === managedClubId || f.awayId === managedClubId);
      const result = f.played ? `${f.homeGoals}-${f.awayGoals}` : '未开始';
      const li = el(
        'li',
        { class: `schedule__row${mine ? ' schedule__row--mine' : ''}` },
        `${f.homeName} vs ${f.awayName} · ${result}`,
      );
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
  }
  return wrap;
}

/** 「我的下一场比赛」卡片（Batch A）。 */
function renderNextFixture(f) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('h2', { class: 'card__title' }, '下一场比赛'));
  card.appendChild(el('p', { class: 'muted' }, `第 ${f.round} 轮 · ${f.date} · ${f.isHome ? '主场' : '客场'}`));
  card.appendChild(el('p', {}, `${f.homeName}  vs  ${f.awayName}`));
  return card;
}

/** 生涯开场界面（Batch A）：从数据库球队列表中选择管理球队后进入主界面。 */
function renderCareerStart(snapshot) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('h2', { class: 'card__title' }, '新建生涯 · 选择你的球队'));

  if (!snapshot.clubs || snapshot.clubs.length === 0) {
    card.appendChild(el('p', { class: 'muted' }, '当前世界没有可用球队。'));
    return card;
  }

  card.appendChild(el('p', { class: 'muted' }, '选择一支球队开始管理；也可以选择不管理任何球队，由 AI 全自动管理世界。'));
  const ul = el('ul', { class: 'list career' });
  for (const club of snapshot.clubs) {
    const li = el('li', { class: 'career__item' });
    li.appendChild(el('button', {
      class: 'btn btn--small career__btn',
      'data-action': 'start-career',
      'data-club': club.id,
    }, club.name));
    ul.appendChild(li);
  }
  card.appendChild(ul);

  const skip = el('div', { class: 'row-actions' });
  skip.appendChild(el('button', {
    class: 'btn btn--small',
    'data-action': 'start-career',
    'data-club': '',
  }, '不管理任何球队（全自动）'));
  card.appendChild(skip);
  return card;
}

/** 推进结果文案（纯呈现）。 */
function describeAdvance(summary, label) {
  if (summary && summary.seasonAfter != null && summary.seasonAfter !== summary.seasonBefore) {
    return `赛季已结束，进入第 ${summary.seasonAfter} 赛季`;
  }
  const days = summary?.daysAdvanced ?? 0;
  if (days === 0) return `已无更多可推进的${label}`;
  return `已推进到${label}（+${days} 天）`;
}

/** 构建积分榜表格（当前赛季 / 上赛季共用）。 */
function buildTable(rows) {
  const table = el('table', { class: 'table' });
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['#', '球队', '场', '胜', '平', '负', '进', '失', '净', '分']) {
    headRow.appendChild(el('th', {}, h));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', {}, String(i + 1)));
    tr.appendChild(el('td', { class: 'table__team' }, row.teamName));
    for (const v of [row.played, row.won, row.drawn, row.lost, row.gf, row.ga, row.gd, row.points]) {
      tr.appendChild(el('td', {}, String(v)));
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}