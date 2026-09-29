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