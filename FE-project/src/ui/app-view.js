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

  /** 比赛中心播放状态（仅展示层，不改变真实赛果）：{ fixtureId, step, playing } | null。 */
  #matchView = null;

  /** 自动播放计时器（仅用于演出节奏；不参与任何比赛模拟随机）。 */
  #playTimer = null;

  /** 绑定事件并订阅状态变化。 */
  mount() {
    const actions = document.getElementById('app-actions');
    actions?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.#handleAction(btn.dataset.action);
    });
    // 视图内交互（玩家阵容 / 战术 / 比赛中心）：事件委托，UI 只转发，规则在 Controller。
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
    this.#stopTimer();
    this.#unsubscribe?.();
  }

  async #handleAction(action) {
    try {
      if (action === 'new-career') {
        this.#closeMatch();
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
        this.#closeMatch();
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

      // 比赛中心（Batch B）：全部为展示层状态，不触发任何比赛结算。
      if (action === 'open-match') {
        this.#matchView = { fixtureId: btn.dataset.fixture, step: 0, playing: false };
        this.setStatus('比赛中心：可开始/暂停观看演出');
        return;
      }
      if (action === 'close-match') {
        this.#closeMatch();
        this.setStatus('已返回主界面');
        return;
      }
      if (action === 'play-reset') {
        if (this.#matchView) {
          this.#matchView.step = 0;
          this.#matchView.playing = false;
        }
        this.#stopTimer();
        this.render(this.controller.getSnapshot());
        return;
      }
      if (action === 'play-prev' || action === 'play-next') {
        const show = this.#currentShow();
        if (show && this.#matchView) {
          const max = show.timeline.length - 1;
          const delta = action === 'play-next' ? 1 : -1;
          this.#matchView.step = Math.min(max, Math.max(0, this.#matchView.step + delta));
        }
        this.render(this.controller.getSnapshot());
        return;
      }
      if (action === 'play-toggle') {
        if (this.#matchView) {
          const show = this.#currentShow();
          const max = show ? show.timeline.length - 1 : 0;
          if (!this.#matchView.playing && this.#matchView.step >= max) {
            this.#matchView.step = 0; // 已到结尾：从头重播
          }
          this.#matchView.playing = !this.#matchView.playing;
          if (this.#matchView.playing) this.#startTimer();
          else this.#stopTimer();
        }
        this.render(this.controller.getSnapshot());
        return;
      }

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

  /** 当前正在观看的比赛演出模型（只读；fixture 不存在返回 null）。 */
  #currentShow() {
    if (!this.#matchView) return null;
    return this.controller.getMatchShow(this.#matchView.fixtureId);
  }

  /** 退出比赛中心，回到主界面。 */
  #closeMatch() {
    this.#stopTimer();
    this.#matchView = null;
    this.render(this.controller.getSnapshot());
  }

  #startTimer() {
    this.#stopTimer();
    this.#playTimer = setInterval(() => this.#tickPlayback(), 1200);
  }

  #stopTimer() {
    if (this.#playTimer != null) {
      clearInterval(this.#playTimer);
      this.#playTimer = null;
    }
  }

  /** 自动播放一步（仅演出节奏；不触发任何比赛模拟或结算）。 */
  #tickPlayback() {
    if (!this.#matchView) {
      this.#stopTimer();
      return;
    }
    const show = this.#currentShow();
    if (!show) {
      this.#closeMatch();
      return;
    }
    const max = show.timeline.length - 1;
    if (this.#matchView.step >= max) {
      this.#matchView.playing = false;
      this.#stopTimer();
    } else {
      this.#matchView.step += 1;
    }
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

    // 比赛中心（Batch B）：观看演出时切换到演出视图（纯展示层状态）。
    if (this.#matchView) {
      const show = this.#currentShow();
      if (show) {
        this.root.appendChild(renderMatchView(show, this.#matchView));
        return;
      }
      // 演出对象已不存在（例如赛季滚动后旧赛程被替换）：安全回退主界面。
      this.#matchView = null;
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

    // 比赛中心（Batch B）：下一场说明 + 已结算比赛观看入口。
    this.root.appendChild(renderMatchCenter(snapshot));

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

// ---------------------------------------------------------------------------
// 比赛中心（Batch B）：全部为**纯呈现**，数据来自 Controller 只读快照/演出模型。
// 不触发任何比赛模拟或结算；球场点位为展示层派生，非物理模拟位置。
// ---------------------------------------------------------------------------

/** 汇总已结算比赛（跨联赛，按日期/轮次倒序，移动端限量）。 */
function collectPlayedFixtures(snapshot) {
  const all = [];
  for (const league of snapshot.leagues) {
    for (const f of league.fixtures) {
      if (f.played) all.push(f);
    }
  }
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.round - a.round));
  return all.slice(0, 12);
}

/** 比赛中心卡片：下一场说明 + 已结算比赛观看入口。 */
function renderMatchCenter(snapshot) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('h2', { class: 'card__title' }, '比赛中心'));

  card.appendChild(el('h3', { class: 'card__subtitle' }, '下一场'));
  if (snapshot.nextFixture) {
    const f = snapshot.nextFixture;
    card.appendChild(el('p', {}, `${f.homeName} vs ${f.awayName} · 第 ${f.round} 轮 · ${f.date}`));
    card.appendChild(el('p', { class: 'muted' }, '该场尚未结算。请先「推进到下一场」；同一轮比赛共享日期，推进可能同时结算整轮，结算后可在此观看演出与赛后报告。'));
  } else {
    card.appendChild(el('p', { class: 'muted' }, '当前没有我的比赛（或尚未选择管理球队）。'));
  }

  const played = collectPlayedFixtures(snapshot);
  card.appendChild(el('h3', { class: 'card__subtitle' }, '已结算比赛'));
  if (played.length === 0) {
    card.appendChild(el('p', { class: 'muted' }, '暂无已结算比赛。'));
    return card;
  }
  const ul = el('ul', { class: 'list match-list' });
  for (const f of played) {
    const li = el('li', { class: 'match-list__item' });
    li.appendChild(el('span', { class: 'match-list__text' }, `第 ${f.round} 轮 · ${f.homeName} ${f.homeGoals}-${f.awayGoals} ${f.awayName} · ${f.date}`));
    li.appendChild(el('button', {
      class: 'btn btn--mini',
      'data-action': 'open-match',
      'data-fixture': f.id,
    }, '查看比赛'));
    ul.appendChild(li);
  }
  card.appendChild(ul);
  return card;
}

/** 比赛演出视图：比分板 + 俯视球场 + 文字直播时间轴 + 播放控制 + 赛后报告。 */
function renderMatchView(show, view) {
  const card = el('section', { class: 'card' });
  const head = el('div', { class: 'match-head' });
  head.appendChild(el('h2', { class: 'card__title' }, '比赛中心'));
  head.appendChild(el('button', { class: 'btn btn--mini', 'data-action': 'close-match' }, '返回主界面'));
  card.appendChild(head);
  card.appendChild(el('p', { class: 'muted' }, `第 ${show.round} 轮 · ${show.date} · 第 ${show.season} 赛季`));

  if (!show.played) {
    card.appendChild(el('p', {}, `${show.home.name} vs ${show.away.name}`));
    card.appendChild(el('p', { class: 'muted' }, '该场比赛尚未结算，无法观看演出。请先推进比赛。'));
    return card;
  }

  const step = Math.min(Math.max(0, view.step), show.timeline.length - 1);
  const entry = show.timeline[step];

  const score = el('div', { class: 'scoreline' });
  score.appendChild(el('span', { class: 'scoreline__team' }, show.home.name));
  score.appendChild(el('span', { class: 'scoreline__score' }, `${entry.score.home} - ${entry.score.away}`));
  score.appendChild(el('span', { class: 'scoreline__team scoreline__team--away' }, show.away.name));
  card.appendChild(score);

  card.appendChild(renderPitch(show, entry.ball));

  const narr = el('div', { class: 'narration' });
  narr.appendChild(el('span', { class: 'narration__minute' }, minuteLabel(entry)));
  narr.appendChild(el('span', { class: 'narration__text' }, narrationText(entry)));
  card.appendChild(narr);

  const ctrl = el('div', { class: 'row-actions' });
  ctrl.appendChild(el('button', { class: 'btn btn--small', 'data-action': 'play-reset' }, '重新播放'));
  ctrl.appendChild(el('button', { class: 'btn btn--small', 'data-action': 'play-prev' }, '上一事件'));
  ctrl.appendChild(el('button', { class: 'btn btn--small', 'data-action': 'play-toggle' }, view.playing ? '暂停' : '播放'));
  ctrl.appendChild(el('button', { class: 'btn btn--small', 'data-action': 'play-next' }, '下一事件'));
  card.appendChild(ctrl);
  card.appendChild(el('p', { class: 'muted' }, `演出进度：第 ${step + 1} / ${show.timeline.length} 步${view.playing ? ' · 播放中' : ''}`));

  card.appendChild(el('h3', { class: 'card__subtitle' }, '文字直播（事件时间轴）'));
  const tl = el('ul', { class: 'list timeline' });
  show.timeline.forEach((e, i) => {
    tl.appendChild(el(
      'li',
      { class: `timeline__item${i === step ? ' timeline__item--current' : ''}` },
      `${minuteLabel(e)} ${narrationText(e)}`,
    ));
  });
  card.appendChild(tl);

  card.appendChild(renderReport(show));
  return card;
}

/** 分钟/阶段标签（纯呈现）。 */
function minuteLabel(entry) {
  if (entry.kind === 'kickoff') return "0'";
  if (entry.kind === 'halftime') return '半场';
  if (entry.kind === 'fulltime') return '终场';
  return `${entry.minute}'`;
}

/** 事件旁白文案（纯呈现；进球者/助攻者来自真实事件，缺失时优雅降级）。 */
function narrationText(entry) {
  if (entry.kind === 'kickoff') return '比赛开始';
  if (entry.kind === 'halftime') return `半场结束（${entry.score.home}-${entry.score.away}）`;
  if (entry.kind === 'fulltime') return `比赛结束（${entry.score.home}-${entry.score.away}）`;
  const scorer = entry.scorerName ?? '未知球员';
  const assist = entry.assistName ? `（助攻：${entry.assistName}）` : '';
  return `${entry.teamName ?? '未知球队'}进球 — ${scorer}${assist}`;
}

/** 俯视球场 SVG：两队阵型点位 + 足球（点位为展示层派生，非物理位置）。 */
function renderPitch(show, ball) {
  const wrap = el('div', { class: 'pitch' });
  const svg = svgEl('svg', { viewBox: '0 0 100 64', class: 'pitch__svg', preserveAspectRatio: 'xMidYMid meet' });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: 100, height: 64, class: 'pitch__bg' }));
  svg.appendChild(svgEl('rect', { x: 1, y: 1, width: 98, height: 62, class: 'pitch__line' }));
  svg.appendChild(svgEl('line', { x1: 50, y1: 1, x2: 50, y2: 63, class: 'pitch__line' }));
  svg.appendChild(svgEl('circle', { cx: 50, cy: 32, r: 6, class: 'pitch__line' }));
  svg.appendChild(svgEl('rect', { x: 1, y: 16, width: 12, height: 32, class: 'pitch__line' }));
  svg.appendChild(svgEl('rect', { x: 87, y: 16, width: 12, height: 32, class: 'pitch__line' }));
  svg.appendChild(svgEl('rect', { x: 0, y: 27, width: 1, height: 10, class: 'pitch__goal' }));
  svg.appendChild(svgEl('rect', { x: 99, y: 27, width: 1, height: 10, class: 'pitch__goal' }));
  for (const p of show.formation.home) {
    svg.appendChild(svgEl('circle', { cx: p.x * 100, cy: p.y * 64, r: 1.7, class: 'pitch__dot pitch__dot--home' }));
  }
  for (const p of show.formation.away) {
    svg.appendChild(svgEl('circle', { cx: p.x * 100, cy: p.y * 64, r: 1.7, class: 'pitch__dot pitch__dot--away' }));
  }
  svg.appendChild(svgEl('circle', { cx: ball.x * 100, cy: ball.y * 64, r: 1.2, class: 'pitch__ball' }));
  wrap.appendChild(svg);
  wrap.appendChild(el('p', { class: 'muted pitch__legend' }, '圆点为两队阵型（展示层派生，非连续 Tick 物理位置）；白点为足球。'));
  return wrap;
}

/** 赛后报告：仅展示生产模拟器真实提供的数据；未提供项不伪造。 */
function renderReport(show) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('h2', { class: 'card__title' }, '赛后报告'));
  card.appendChild(el('p', {}, `${show.home.name} ${show.score.home} - ${show.score.away} ${show.away.name}`));
  card.appendChild(el('p', { class: 'muted' }, `第 ${show.round} 轮 · ${show.date} · 第 ${show.season} 赛季`));

  const goals = show.timeline.filter((e) => e.kind === 'goal');
  card.appendChild(el('h3', { class: 'card__subtitle' }, `进球事件（${goals.length}）`));
  if (goals.length === 0) {
    card.appendChild(el('p', { class: 'muted' }, show.hasEvents ? '本场无进球。' : '该场无详细事件记录（可能来自旧存档）。'));
  } else {
    const ul = el('ul', { class: 'list' });
    for (const g of goals) {
      const assist = g.assistName ? `（助攻：${g.assistName}）` : '（助攻：—）';
      ul.appendChild(el('li', {}, `第 ${g.minute} 分钟 · ${g.teamName} · ${g.scorerName ?? '未知球员'} ${assist}`));
    }
    card.appendChild(ul);
  }
  card.appendChild(el('p', { class: 'muted' }, '本报告仅展示该场真实比分与真实进球事件（进球者/助攻者来自真实数据）。射门、控球率、传球成功率等逐场统计在本 Demo 中未持久化到赛程，故不在此显示（未提供即不伪造精确数值）。'));
  return card;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}