import { createHandler } from "../server.mjs";

const handler = createHandler();

export default function vercelHandler(req, res) {
  return handler(req, res);
}
