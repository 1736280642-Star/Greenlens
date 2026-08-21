import http from "node:http";

const listenHost = "127.0.0.1";
const listenPort = Number(process.env.GREENLENS_PROXY_PORT ?? 3130);
const targetHost = "127.0.0.1";
const targetPort = Number(process.env.GREENLENS_TARGET_PORT ?? 3030);

const server = http.createServer((request, response) => {
  const upstream = http.request({
    hostname: targetHost,
    port: targetPort,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, host: `${targetHost}:${targetPort}` },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.setTimeout(120_000, () => upstream.destroy(new Error("GreenLens upstream timed out.")));
  upstream.on("error", (error) => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      cause: "GreenLens loopback proxy could not reach the local backend.",
      impact: "The ingestion request was not forwarded.",
      nextAction: "Confirm the GreenLens backend is listening on 127.0.0.1:3030.",
      detail: error.code ?? error.name,
    }));
  });
  request.pipe(upstream);
});

server.listen(listenPort, listenHost);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
