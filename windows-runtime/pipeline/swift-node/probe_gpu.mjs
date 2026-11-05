import { InferenceSession, Tensor } from "onnxruntime-node";

const modelPath = process.argv[2];
if (!modelPath) throw new Error("Usage: probe_gpu.mjs <small-onnx-model>");

// Prefer DirectML on Windows for broad vendor support; WebGPU is the fallback.
// Other platforms can use WebGPU where the bundled ONNX Runtime provides it.
const providers = process.platform === "win32" ? ["dml", "webgpu"] : ["webgpu"];

for (const device of providers) {
  let session;
  try {
    session = await InferenceSession.create(modelPath, {
      executionProviders: [device],
      logSeverityLevel: 3,
    });
    const metadata = session.inputMetadata[0];
    const dims = metadata.shape.map((dimension) =>
      Number.isInteger(dimension) && dimension > 0 ? dimension : 1
    );
    const size = dims.reduce((product, dimension) => product * dimension, 1);
    const output = await session.run({
      [session.inputNames[0]]: new Tensor(metadata.type, new Float32Array(size).fill(0.25), dims),
    });
    const firstOutput = output[session.outputNames[0]]?.data?.[0];
    if (!Number.isFinite(Number(firstOutput))) throw new Error("GPU probe inference returned no result.");
    console.log(JSON.stringify({ device }));
    process.exitCode = 0;
    break;
  } catch {
    if (device === providers.at(-1)) {
      console.error("No usable Transformers.js GPU provider was found.");
      process.exitCode = 1;
    }
  } finally {
    await session?.release();
  }
}
