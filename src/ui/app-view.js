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
      if (action === 'tick') {
        this.controller.tick();
        this.setStatus('已推进一天');
      } else if (action === 'advance-week') {
        this.controller.advanceDays(7);
        this.setStatus('已推进一周');
      } else if (action === 'save') {
        const slot = await this.controller.save('slot1');
        this.setStatus(`已保存到存档 ${slot}`);
      } else if (action === 'load') {
        await this.controller.load('slot1');
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

    const card = el('section', { class: 'card' });
    card.appendChild(el('h2', { class: 'card__title' }, '当前游戏状态'));

    const dl = el('dl', { class: 'kv' });
    appendKV(dl, '世界', `${snapshot.worldName} (${snapshot.worldId})`);
    appendKV(dl, '日期', snapshot.currentDate);
    appendKV(dl, '赛季', String(snapshot.season));
    appendKV(dl, '球队数', String(snapshot.teamsCount));
    appendKV(dl, '球员数', String(snapshot.playersCount));
    appendKV(dl, '事件数', String(snapshot.eventsCount));
    card.appendChild(dl);
    this.root.appendChild(card);

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
      this.root.appendChild(renderLeague(league));
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

/** 渲染单个联赛卡片：概览 + 积分榜 + 最近赛果。纯呈现。 */
function renderLeague(league) {
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

  return card;
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