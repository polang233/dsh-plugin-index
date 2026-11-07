const original = value => value?.[Symbol.for('cordis.original')] ?? value;
const liveJob = job => ['running', 'stopping'].includes(job.status);

/** Reserve idle Agents without cancelling a turn or consuming its pending input. */
export function createTaskGuard({get, events}) {
  let window;
  const created = ({agent}) => {
    if (window) reserve(agent, window);
  };
  const off = events.on('agent/created', created);

  function services() {
    const agents = original(get('agents'));
    const workspaces = original(get('workspaceRegistry'));
    const jobs = original(get('jobs'));
    if (typeof agents?.list !== 'function' || typeof workspaces?.list !== 'function'
      || typeof events.waterfall !== 'function') throw Error('task-monitor-unavailable');
    return {agents, workspaces, jobs};
  }

  function inventory() {
    const {agents, workspaces, jobs} = services();
    const all = agents.list();
    if (!Array.isArray(all) || all.some(agent => !['idle', 'running'].includes(agent.status)
      || typeof agent.runMaintenance !== 'function')) throw Error('task-monitor-unavailable');
    const ids = new Set(all.map(agent => agent.session?.id ?? agent.id));
    for (const workspace of workspaces.list()) {
      if (!Array.isArray(workspace.sessionIds)) throw Error('task-monitor-unavailable');
      workspace.sessionIds.forEach(id => ids.add(id));
    }
    if ([...ids].some(id => typeof id !== 'string' || !id)) throw Error('task-monitor-unavailable');
    return {all, ids, jobs};
  }

  async function readActivity() {
    try {
      const {all, ids, jobs} = inventory();
      const running = all.filter(agent => agent.status === 'running').length;
      const families = [];
      // The waterfall includes turns waiting for approval, subagents, jobs and schedule activity.
      for (const entries of await Promise.all([...ids].map(sessionId =>
        events.waterfall('workspace/session-activity', {sessionId}, () => Promise.resolve([]))))) {
        if (!Array.isArray(entries)) throw Error('task-monitor-unavailable');
        families.push(...entries);
      }
      const unowned = jobs === undefined ? [] : jobs.list();
      if (!Array.isArray(unowned)) throw Error('task-monitor-unavailable');
      const background = unowned.filter(liveJob).length;
      return {available: true, busy: running > 0 || families.length > 0 || background > 0,
        running, activities: families.length + background};
    } catch {
      return {available: false, busy: true, running: 0, activities: 0};
    }
  }

  async function activity() {
    let timer;
    try {
      return await Promise.race([readActivity(), new Promise(resolve => {
        timer = setTimeout(() => resolve({available: false, busy: true, running: 0, activities: 0}), 5000);
      })]);
    } finally { clearTimeout(timer); }
  }

  function reserve(agent, lease) {
    if (lease.agents.has(agent)) return;
    if (agent.status !== 'idle' || typeof agent.runMaintenance !== 'function') throw Error('tasks-active');
    lease.agents.add(agent);
    let entered = false;
    const task = agent.runMaintenance(async signal => {
      entered = true;
      // An Agent being disposed by reconciliation cannot start another turn.
      // A user's stop request must not release the maintenance window early.
      let dispose;
      const disposed = new Promise(resolve => {
        dispose = () => { if (signal.reason?.kind === 'disposed') resolve(); };
        signal.addEventListener('abort', dispose);
        if (signal.aborted) dispose();
      });
      try { await Promise.race([lease.done, disposed]); }
      finally { signal.removeEventListener('abort', dispose); }
    });
    lease.tasks.push(Promise.resolve(task).catch(error => { lease.error ??= error; }));
    if (!entered) throw Error('task-monitor-unavailable');
  }

  async function run(operation) {
    if (window) return {ok: false, code: 'management-busy'};
    let release;
    const lease = {agents: new Set(), tasks: [], done: new Promise(resolve => { release = resolve; })};
    try {
      try {
        const {all} = inventory();
        if (all.some(agent => agent.status !== 'idle')) return {ok: false, code: 'tasks-active'};
        // Claim synchronously. Waking input cannot interleave the reservations.
        window = lease;
        for (const agent of all) reserve(agent, lease);
        const status = await activity();
        if (!status.available) return {ok: false, code: 'task-monitor-unavailable'};
        if (status.busy) return {ok: false, code: 'tasks-active'};
        if (lease.error) throw lease.error;
      } catch (error) {
        return {ok: false, code: error.message === 'tasks-active' ? 'tasks-active' : 'task-monitor-unavailable'};
      }
      return await operation();
    } finally {
      if (window === lease) window = undefined;
      release();
      await Promise.all(lease.tasks);
    }
  }

  return {activity, run, dispose: () => { if (window) throw Error('Maintenance is still running'); off(); }};
}
