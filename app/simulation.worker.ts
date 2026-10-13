import {
  SimulationStepRequest,
  SimulationStepResponse,
  simulateElapsedWithActivity,
} from "./simulation-protocol";

self.onmessage = (event: MessageEvent<SimulationStepRequest>) => {
  if (event.data.type !== "step") return;
  const startedAt = event.data.measurePerformance ? performance.now() : null;
  const { state, activity } = simulateElapsedWithActivity(event.data.state, event.data.seconds);
  const response: SimulationStepResponse = {
    type: "stepped",
    id: event.data.id,
    state,
    activity,
    seconds: event.data.seconds,
    simulationMs: startedAt === null ? undefined : performance.now() - startedAt,
  };
  self.postMessage(response);
};

export {};
