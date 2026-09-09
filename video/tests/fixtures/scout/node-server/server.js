// A realistic tiny product: listens on PORT and HOST, answers HTML at /.
import { createServer } from "node:http";
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>acme</title><h1>acme on ${port}</h1>`);
}).listen(port, host, () => {
  console.log(`acme listening on http://localhost:${port}`);
});
