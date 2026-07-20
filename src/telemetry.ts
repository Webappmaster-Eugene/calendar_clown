/**
 * Must be imported BEFORE any other module for auto-instrumentation to hook in.
 * Enabled by setting OTEL_EXPORTER_OTLP_ENDPOINT; without it, telemetry is a no-op.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { trace, type Tracer } from "@opentelemetry/api";

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

let sdk: NodeSDK | null = null;

if (OTEL_ENDPOINT) {
  const traceExporter = new OTLPTraceExporter({ url: `${OTEL_ENDPOINT}/v1/traces` });

  sdk = new NodeSDK({
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
    serviceName: process.env.OTEL_SERVICE_NAME ?? "sovetnik-bot",
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}

export function getTracer(name = "sovetnik"): Tracer {
  return trace.getTracer(name);
}
