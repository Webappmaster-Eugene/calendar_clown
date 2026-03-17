/**
 * OpenTelemetry initialization — must be imported BEFORE any other module.
 *
 * Instruments HTTP, pg, and ioredis automatically.
 * Exports a tracer for manual spans on key operations.
 *
 * To enable, set OTEL_EXPORTER_OTLP_ENDPOINT in env (e.g. http://localhost:4318).
 * Without the env var, telemetry is a no-op.
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

/** Gracefully shut down the OTEL SDK (call from shutdown handler). */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}

/** Get a tracer for manual instrumentation of key operations. */
export function getTracer(name = "sovetnik"): Tracer {
  return trace.getTracer(name);
}
