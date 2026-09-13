import { Router, text } from "express";
import { adminController } from "../controllers/admin.controller";
import { applicationController } from "../controllers/application.controller";
import { healthController } from "../controllers/health.controller";
import { policyController } from "../controllers/policy.controller";
import { adminAuthMiddleware } from "../middleware/admin-auth";
import { authMiddleware } from "../middleware/auth";

export const v1 = Router();

v1.use(text({ type: () => true, limit: "2mb" }));
v1.use(authMiddleware.apiKey());

v1.get("/health", healthController.show);
v1.get("/keepalive", healthController.keepalive);

v1.use("/admin", adminAuthMiddleware.guard());
v1.get("/admin/config", adminController.show);
v1.put("/admin/config", adminController.update);

v1.post("/applications", applicationController.create);
v1.get("/applications", applicationController.list);
v1.get("/applications/:id", applicationController.show);

v1.get("/policies", policyController.list);

v1.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});
