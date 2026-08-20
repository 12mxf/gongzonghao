import { createApplication } from "./app.js";

const { app, config } = createApplication();
app.listen(config.port, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "server_ready", url: `http://127.0.0.1:${config.port}` }));
});
