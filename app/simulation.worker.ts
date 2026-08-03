import {
  SimulationStepRequest,
  SimulationStepResponse,
  simulateElapsed,
} from "./simulation-protocol";

self.onmessage = (event: MessageEvent<SimulationStepRequest>) => {
  if (event.data.type !== "step") return;
  const response: SimulationStepResponse = {
    type: "stepped",
    id: event.data.id,
    state: simulateElapsed(event.data.state, event.data.seconds),
    seconds: event.data.seconds,
  };
  self.postMessage(response);
};

export {};
