'use strict';
function renderProgress(completed, total, fraction = 0, elapsedSeconds = 0) {
  const done = Math.max(0, Math.min(total, completed));
  const current = Math.max(0, Math.min(1, fraction));
  const units = Math.min(total, done + current);
  return {
    completed: done, total, current: Math.min(total, done + 1), fraction: current,
    percent: Math.min(98, 75 + 23 * units / total),
    etaSeconds: units > .1 && elapsedSeconds > 0 ? Math.max(0, Math.ceil(elapsedSeconds / units * (total - units))) : null,
  };
}
module.exports = { renderProgress };
