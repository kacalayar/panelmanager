import { Hono } from "hono";
import { TEMPLATE_CATALOG } from "@panelmanager/templates";

export function createTemplateRoutes() {
  const router = new Hono();
  router.get("/", (c) => {
    return c.json({ templates: TEMPLATE_CATALOG });
  });
  return router;
}
