/**
 * AI Action Layer —— Step 31 / D-AI-03、D-AI-04、D-AI-18、D-AI-22。
 * 层级归属：Simulation Core / AI。**不重新实现任何 Domain 规则**：只把 Decision Object 映射到
 * 现有 Domain API（transferPlayer / signFreeAgent / releasePlayerToFreeAgent / 合法 lineup 能力）。
 * `SELL_PLAYER`（AI 主动出售，D-33.4）同样只经 `transferPlayer()`。
 *
 * 约束：
 * - 绝不直接改 membership / contract / finance / generated registry。
 * - Domain 抛错时：不半提交、不吞错，返回稳定 code，AI cycle 可继续。
 * - 成功执行后记录 **runtime-only** `ai_decision` 事件（不新增事件体系、不做自然语言推理）。
 */

import { signFreeAgent } from '../free-agent.js';
import { releasePlayerToFreeAgent } from '../free-agent.js';
import { transferPlayer } from '../transfer.js';
import { buildAutoLineup } from '../team-strength.js';
import { cleanLineup, validateLineup } from '../player-lineup.js';
import { recordEvent } from '../game-state.js';

/** 记录成功执行的 AI 决策事件（简短结构化；无自然语言）。 */
function recordAIDecision(state, decision) {
  recordEvent(state, 'ai_decision', {
    clubId: decision.clubId,
    season: decision.season,
    date: decision.date,
    type: decision.type,
    playerId: decision.playerId,
    targetClubId: decision.targetClubId,
    position: decision.position,
    reasonCode: decision.reasonCode,
    estimatedCost: decision.estimatedCost,
  });
}

/**
 * 执行一个 AI Decision（经 Domain API）。
 * @param {object} state
 * @param {object} decision
 * @returns {{ok: boolean, code?: string, message?: string, playerId?: string|null, clubId?: string}}
 */
export function executeAIAction(state, decision) {
  if (!decision || typeof decision.type !== 'string') {
    return { ok: false, code: 'NO_DECISION' };
  }
  try {
    switch (decision.type) {
      case 'SIGN_FREE_AGENT': {
        const r = signFreeAgent(state, decision.playerId, decision.clubId);
        recordAIDecision(state, decision);
        return { ok: true, playerId: r.playerId, clubId: r.clubId };
      }
      case 'TRANSFER_PLAYER': {
        const r = transferPlayer(state, decision.playerId, decision.clubId);
        // 以 Domain 权威结果回填事件中的成本（Intent 中的 estimatedCost 仅占位）。
        recordAIDecision(state, { ...decision, estimatedCost: r.transferFee });
        return { ok: true, playerId: r.playerId, clubId: r.clubId, transferFee: r.transferFee };
      }
      case 'SELL_PLAYER': {
        // AI 主动出售（D-33.4 / D-34）：`clubId` 为 seller（AI 行动方），`targetClubId` 为 buyer。
        // 仍只经现有 Domain `transferPlayer()`，不创建第二套 Transfer。
        const r = transferPlayer(state, decision.playerId, decision.targetClubId);
        recordAIDecision(state, { ...decision, estimatedCost: r.transferFee });
        return { ok: true, playerId: r.playerId, clubId: r.buyerClubId, transferFee: r.transferFee };
      }
      case 'RELEASE_PLAYER': {
        const r = releasePlayerToFreeAgent(state, decision.playerId);
        recordAIDecision(state, decision);
        return { ok: true, playerId: r.playerId, clubId: r.fromClubId };
      }
      case 'UPDATE_LINEUP': {
        const club = state.runtime.clubs[decision.clubId];
        if (!club) return { ok: false, code: 'CLUB_NOT_FOUND' };
        const lineup = cleanLineup(state, decision.clubId, buildAutoLineup(state, decision.clubId, club.tactics ?? {}));
        validateLineup(state, decision.clubId, lineup);
        club.lineup = lineup;
        recordAIDecision(state, decision);
        return { ok: true, clubId: decision.clubId };
      }
      default:
        return { ok: false, code: 'UNKNOWN_DECISION_TYPE' };
    }
  } catch (err) {
    return {
      ok: false,
      code: err?.code ?? 'AI_ACTION_FAILED',
      message: err?.describe?.() ?? String(err),
    };
  }
}
