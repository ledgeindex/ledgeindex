import { Inngest } from "inngest";

const isDev =
  process.env.INNGEST_DEV === "1" ||
  (process.env.NODE_ENV !== "production" && !process.env.INNGEST_SIGNING_KEY);

export const inngest = new Inngest({
  id: "ledgeindex-api",
  eventKey: process.env.INNGEST_EVENT_KEY,
  isDev,
});
