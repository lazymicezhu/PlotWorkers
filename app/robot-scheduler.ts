export type RobotSchedulerOptions = {
  now: () => number;
  random: () => number;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timer: number) => void;
  dispatch: (botIndex: number) => boolean;
  getIntervalSeconds: (botIndex: number) => number;
};

type RobotDeadline = {
  index: number;
  busy: boolean;
  deadline: number | null;
  revision: number;
  heapIndex: number;
};

const OVERDUE_DISPATCH_GAP_MS = 4;

/** Independent robot deadlines, served by one shared timer. All times are milliseconds. */
export function createRobotScheduler(options: RobotSchedulerOptions) {
  let robots: RobotDeadline[] = [];
  let heap: RobotDeadline[] = [];
  let initialized = false;
  let enabled = false;
  let disposed = false;
  let generation = 0;
  let timer: number | null = null;
  let timerDeadline = Infinity;
  let timerRevision = 0;
  let lastDispatchAt = -Infinity;

  const randomBetween = (min: number, max: number) => min + (max - min) * options.random();
  const retryDeadline = () => options.now() + randomBetween(600, 1000);

  function comesBefore(left: RobotDeadline, right: RobotDeadline) {
    return left.deadline! < right.deadline! || (left.deadline === right.deadline && left.index < right.index);
  }

  function swap(left: number, right: number) {
    [heap[left], heap[right]] = [heap[right], heap[left]];
    heap[left].heapIndex = left;
    heap[right].heapIndex = right;
  }

  function bubbleUp(robot: RobotDeadline) {
    while (robot.heapIndex > 0) {
      const parent = Math.floor((robot.heapIndex - 1) / 2);
      if (!comesBefore(robot, heap[parent])) break;
      swap(robot.heapIndex, parent);
    }
  }

  function bubbleDown(robot: RobotDeadline) {
    while (true) {
      const left = robot.heapIndex * 2 + 1;
      const right = left + 1;
      let next = robot.heapIndex;
      if (left < heap.length && comesBefore(heap[left], heap[next])) next = left;
      if (right < heap.length && comesBefore(heap[right], heap[next])) next = right;
      if (next === robot.heapIndex) break;
      swap(robot.heapIndex, next);
    }
  }

  function removeDeadline(robot: RobotDeadline) {
    if (robot.heapIndex === -1) return;
    const index = robot.heapIndex;
    const last = heap.pop()!;
    robot.heapIndex = -1;
    if (index === heap.length) return;
    heap[index] = last;
    last.heapIndex = index;
    bubbleUp(last);
    bubbleDown(last);
  }

  function setDeadline(robot: RobotDeadline, deadline: number | null) {
    removeDeadline(robot);
    robot.deadline = deadline;
    if (deadline === null) return;
    robot.heapIndex = heap.length;
    heap.push(robot);
    bubbleUp(robot);
  }

  function cancelTimer() {
    timerRevision += 1;
    if (timer !== null) options.clearTimer(timer);
    timer = null;
    timerDeadline = Infinity;
  }

  function arm() {
    if (disposed || !enabled) {
      cancelTimer();
      return;
    }
    const earliest = heap[0]?.deadline ?? Infinity;
    if (earliest === Infinity) {
      cancelTimer();
      return;
    }
    const currentTime = options.now();
    // Smooth only an overdue backlog. Independently scheduled future deadlines
    // retain their timing, even when they are less than 4 ms apart.
    const nextDeadline = earliest <= currentTime
      ? Math.max(currentTime, lastDispatchAt + OVERDUE_DISPATCH_GAP_MS)
      : earliest;
    if (timer !== null && timerDeadline === nextDeadline) return;
    cancelTimer();
    timerDeadline = nextDeadline;
    const revision = timerRevision;
    timer = options.setTimer(() => {
      if (disposed || revision !== timerRevision) return;
      timer = null;
      timerDeadline = Infinity;
      dispatchNext();
    }, Math.max(0, Math.ceil(nextDeadline - currentTime)));
  }

  function dispatchNext() {
    if (disposed || !enabled) return;
    const currentTime = options.now();
    const robot = heap[0];
    if (!robot || robot.deadline! > currentTime) {
      arm();
      return;
    }

    const selectedIndex = robot.index;
    robot.busy = true;
    setDeadline(robot, null);
    lastDispatchAt = currentTime;
    const dispatchGeneration = generation;
    const dispatchRevision = robot.revision;
    let started = false;
    try {
      started = options.dispatch(selectedIndex);
    } finally {
      // A dispatch may synchronously complete, release, reset, or dispose the scheduler.
      if (!disposed && generation === dispatchGeneration && robots[selectedIndex] === robot) {
        if (!started && robot.revision === dispatchRevision) {
          robot.busy = false;
          setDeadline(robot, enabled ? retryDeadline() : null);
        }
        arm();
      }
    }
  }

  function sync(count: number, nextEnabled: boolean) {
    if (disposed) return;
    const nextCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (initialized && nextCount === robots.length && nextEnabled === enabled) return;
    const wasEnabled = enabled;
    const previousCount = robots.length;
    initialized = true;
    enabled = nextEnabled;
    while (robots.length > nextCount) removeDeadline(robots.pop()!);
    while (robots.length < nextCount) {
      robots.push({ index: robots.length, busy: false, deadline: null, revision: 0, heapIndex: -1 });
    }
    const currentTime = options.now();
    const firstChanged = !enabled || !wasEnabled ? 0 : previousCount;
    for (let index = firstChanged; index < robots.length; index += 1) {
      const robot = robots[index];
      if (robot.busy) continue;
      setDeadline(robot, enabled ? currentTime + randomBetween(0, 3000) : null);
    }
    arm();
  }

  function complete(botIndex: number) {
    const robot = robots[botIndex];
    if (disposed || !robot?.busy) return;
    robot.busy = false;
    robot.revision += 1;
    setDeadline(robot, enabled
      ? options.now() + Math.max(100, options.getIntervalSeconds(botIndex) * 1000 * randomBetween(.9, 1.1))
      : null);
    arm();
  }

  function release(botIndex: number) {
    const robot = robots[botIndex];
    if (disposed || !robot?.busy) return;
    robot.busy = false;
    robot.revision += 1;
    setDeadline(robot, enabled ? retryDeadline() : null);
    arm();
  }

  function reset() {
    cancelTimer();
    generation += 1;
    robots = [];
    heap = [];
    initialized = false;
    enabled = false;
    lastDispatchAt = -Infinity;
  }

  function dispose() {
    reset();
    disposed = true;
  }

  return { sync, complete, release, reset, dispose };
}
