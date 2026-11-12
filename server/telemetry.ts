import type {
  FaultPreset,
  IoTNode,
  NodeHealth,
  TelemetryBaseline,
  TelemetryPoint,
} from "./types.js";

const MAX_HISTORY = 15;

function jitter(base: number, amplitude: number, min = 0): number {
  const val = base + (Math.random() - 0.5) * 2 * amplitude;
  return Number(Math.max(min, val).toFixed(2));
}

function buildBaselinePoint(baseline: TelemetryBaseline): TelemetryPoint {
  return {
    timestamp: new Date().toISOString(),
    tempC: jitter(baseline.tempC, 1.2, 15),
    vibrationMmS: jitter(baseline.vibrationMmS, 0.25, 0.1),
    fanRpm: Math.round(jitter(baseline.fanRpm, 45, 0)),
    currentAmps: jitter(baseline.currentAmps, 0.2, 0.1),
  };
}

function seedHistory(baseline: TelemetryBaseline): TelemetryPoint[] {
  const now = Date.now();
  const points: TelemetryPoint[] = [];
  for (let i = MAX_HISTORY - 1; i >= 0; i--) {
    const pt = buildBaselinePoint(baseline);
    pt.timestamp = new Date(now - i * 3000).toISOString();
    points.push(pt);
  }
  return points;
}

function createInitialNodes(): IoTNode[] {
  const specs: Array<{
    id: string;
    name: string;
    location: string;
    machineType: string;
    uptimeHours: number;
    baseline: TelemetryBaseline;
  }> = [
    {
      id: "CNC-04",
      name: "5-Axis CNC Mill #04",
      location: "Bay A - Pune Plant",
      machineType: "Industrial CNC Spindle",
      uptimeHours: 1420,
      baseline: { tempC: 54, vibrationMmS: 2.1, fanRpm: 3200, currentAmps: 6.2 },
    },
    {
      id: "COLD-07",
      name: "Pharma Cold-Chain Unit #07",
      location: "Warehouse C",
      machineType: "Cryogenic Compressor",
      uptimeHours: 2910,
      baseline: { tempC: 41, vibrationMmS: 1.6, fanRpm: 2600, currentAmps: 4.8 },
    },
    {
      id: "HVAC-02",
      name: "Cleanroom Air Handler #02",
      location: "Lab Cleanroom",
      machineType: "HEPA Blower Array",
      uptimeHours: 890,
      baseline: { tempC: 36, vibrationMmS: 1.2, fanRpm: 2100, currentAmps: 3.5 },
    },
    {
      id: "PRINT-01",
      name: "Industrial SLA Farm #01",
      location: "Prototyping Lab",
      machineType: "Laser Optical Assembly",
      uptimeHours: 640,
      baseline: { tempC: 45, vibrationMmS: 0.9, fanRpm: 2800, currentAmps: 2.9 },
    },
  ];

  return specs.map((spec) => {
    const history = seedHistory(spec.baseline);
    return {
      ...spec,
      status: "HEALTHY",
      telemetry: history[history.length - 1],
      history,
      activeFault: null,
    };
  });
}

const nodes: IoTNode[] = createInitialNodes();

function computeFaultPoint(node: IoTNode): {
  point: TelemetryPoint;
  status: NodeHealth;
} {
  const b = node.baseline;
  switch (node.activeFault) {
    case "cooling_fan_wear":
      return {
        status: "WARNING",
        point: {
          timestamp: new Date().toISOString(),
          tempC: jitter(b.tempC + 24, 1.5),
          vibrationMmS: jitter(b.vibrationMmS + 3.2, 0.4),
          fanRpm: Math.round(jitter(b.fanRpm * 0.34, 60, 200)),
          currentAmps: jitter(b.currentAmps + 0.9, 0.15),
        },
      };
    case "spindle_controller_burnout":
      return {
        status: "CRITICAL",
        point: {
          timestamp: new Date().toISOString(),
          tempC: jitter(b.tempC + 48, 2.2),
          vibrationMmS: jitter(b.vibrationMmS + 10.4, 0.8),
          fanRpm: Math.round(jitter(b.fanRpm * 0.72, 90, 500)),
          currentAmps: jitter(b.currentAmps + 8.3, 0.5),
        },
      };
    case "ambiguous_drift":
      return {
        status: "WARNING",
        point: {
          timestamp: new Date().toISOString(),
          tempC: jitter(b.tempC + 8, 3.5),
          vibrationMmS: jitter(b.vibrationMmS + 1.1, 0.9),
          fanRpm: Math.round(jitter(b.fanRpm * 0.88, 180, 500)),
          currentAmps: jitter(b.currentAmps + 0.7, 0.6),
        },
      };
    default:
      return {
        status: "HEALTHY",
        point: buildBaselinePoint(b),
      };
  }
}

export function listNodes(): IoTNode[] {
  return nodes;
}

export function getNode(nodeId: string): IoTNode | undefined {
  return nodes.find((n) => n.id === nodeId);
}

export function tickAllNodes(): void {
  for (const node of nodes) {
    const { point, status } = computeFaultPoint(node);
    node.telemetry = point;
    node.status = status;
    node.history = [...node.history.slice(-(MAX_HISTORY - 1)), point];
  }
}

export function injectFault(
  nodeId: string,
  preset: FaultPreset
): IoTNode | undefined {
  const node = getNode(nodeId);
  if (!node) return undefined;

  node.activeFault = preset;
  // Append 3 progressive degradation samples so the trend is visible in history
  for (let i = 0; i < 3; i++) {
    const { point, status } = computeFaultPoint(node);
    node.telemetry = point;
    node.status = status;
    node.history = [...node.history.slice(-(MAX_HISTORY - 1)), point];
  }
  return node;
}

export function resetNode(nodeId: string): IoTNode | undefined {
  const node = getNode(nodeId);
  if (!node) return undefined;

  node.activeFault = null;
  node.status = "HEALTHY";
  const point = buildBaselinePoint(node.baseline);
  node.telemetry = point;
  node.history = [...node.history.slice(-(MAX_HISTORY - 1)), point];
  return node;
}
