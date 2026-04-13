"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var get_lambda_supports_streaming_exports = {};
__export(get_lambda_supports_streaming_exports, {
  getLambdaSupportsStreaming: () => getLambdaSupportsStreaming
});
module.exports = __toCommonJS(get_lambda_supports_streaming_exports);
var import_cjs_module_lexer = require("cjs-module-lexer");
var import_es_module_lexer = require("es-module-lexer");
async function getLambdaSupportsStreaming(lambda, forceStreamingRuntime) {
  if (forceStreamingRuntime) {
    return { supportsStreaming: true };
  }
  if (typeof lambda.supportsResponseStreaming === "boolean") {
    return { supportsStreaming: lambda.supportsResponseStreaming };
  }
  if ("launcherType" in lambda && lambda.launcherType === "Nodejs") {
    return lambdaShouldStream(lambda);
  }
  return { supportsStreaming: void 0 };
}
const HTTP_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "DELETE",
  "PATCH"
];
async function lambdaShouldStream(lambda) {
  const stream = lambda.files?.[lambda.handler]?.toStream();
  if (!stream) {
    return { supportsStreaming: void 0 };
  }
  try {
    const buffer = await streamToBuffer(stream);
    const names = await getFileExports(lambda.handler, buffer.toString("utf8"));
    for (const name of names) {
      if (HTTP_METHODS.includes(name)) {
        return { supportsStreaming: true };
      }
    }
  } catch (err) {
    return {
      supportsStreaming: void 0,
      error: { handler: lambda.handler, message: String(err) }
    };
  }
  return { supportsStreaming: void 0 };
}
async function getFileExports(filename, content) {
  if (filename.endsWith(".mjs")) {
    await import_es_module_lexer.init;
    return (0, import_es_module_lexer.parse)(content)[1].map((specifier) => specifier.n);
  }
  try {
    await (0, import_cjs_module_lexer.init)();
    return (0, import_cjs_module_lexer.parse)(content).exports;
  } catch {
    await import_es_module_lexer.init;
    return (0, import_es_module_lexer.parse)(content)[1].map((specifier) => specifier.n);
  }
}
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const buffers = [];
    stream.on("error", (err) => {
      reject(err);
    });
    stream.on("data", (buffer) => {
      buffers.push(buffer);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getLambdaSupportsStreaming
});
