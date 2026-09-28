/**
 * 组合根（Composition Root）。
 * 负责装配各层依赖并启动应用；**不含业务规则**。
 *
 * 此处体现目标架构的装配关系：
 *   UI Layer → Game Controller → Game State → Simulation Core → Data Layer / Save Layer
 */

import { createLogger } from './shared/logger.js';
import { reportError } from './shared/errors.js';
import { DataLoader } from './data/data-loader.js';
import { LocalStorageSaveManager, MemorySaveManager } from './save/save-manager.js';
import { SimulationCore } from './core/simulation.js';
import { GameController } from './controller/game-controller.js';
import { AppView } from './ui/app-view.js';

/** 骨架阶段使用的最小测试世界。 */
const DEFAULT_WORLD_DIR = 'data/worlds/test-world.fdb';

function pickSaveManager(logger) {
  try {
    return new LocalStorageSaveManager();
  } catch (err) {
    logger?.warn?.('localStorage 不可用，回退到内存存档', err?.message);
    return new MemorySaveManager();
  }
}

async function bootstrap() {
  const logger = createLogger('app', { level: 'debug' });
  const root = document.getElementById('view-root');

  const controller = new GameController({
    dataLoader: new DataLoader({ basePath: '' }),
    saveManager: pickSaveManager(logger),
    simulation: new SimulationCore({ logger }),
    logger,
  });

  const view = new AppView({ root, controller, logger });
  view.mount();

  try {
    await controller.startNewGame(DEFAULT_WORLD_DIR);
    logger.info('启动完成');
  } catch (err) {
    // 启动失败时给出可定位的错误，而不是静默白屏（mobile-ui-ux：边界态必须完整）
    const text = reportError(err, logger);
    if (root) {
      root.textContent = '';
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = `启动失败：\n${text}`;
      root.appendChild(p);
    }
  }
}

bootstrap();